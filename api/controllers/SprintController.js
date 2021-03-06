/**
 * SprintController
 *
 * @module      ::  Controller
 * @description ::  Contains logic for handling requests.
 */
var async = require("async");
var moment = require("moment-timezone");

module.exports = {
    /**
     * Sprint add action.
     *
     * @param   {Request}   req Request object
     * @param   {Response}  res Response object
     */
    add: function(req, res) {
        var projectId = parseInt(req.param("projectId"), 10);

        res.view({
            projectId: projectId
        });
    },

    /**
     * Sprint edit action.
     *
     * @param   {Request}   req Request object
     * @param   {Response}  res Response object
     */
    edit: function(req, res) {
        var sprintId = parseInt(req.param("id"), 10);

        // Fetch sprint data for edit action
        async.parallel(
            {
                // Fetch single sprint data
                sprint: function(callback) {
                    DataService.getSprint(sprintId, callback);
                },

                // Determine user role in this sprint
                role: function(callback) {
                    AuthService.hasSprintAccess(req.user, sprintId, callback, true);
                }
            },

            /**
             * Callback function which is called after all specified parallel jobs are done.
             *
             * @param   {Error} error   Error object
             * @param   {{}}    data    Object that contains sprint and role data
             */
            function (error, data) {
                if (error) {
                    res.send(error.status ? error.status : 500, error);
                } else {
                    res.view(data);
                }
            }
        );
    },

    /**
     * Sprint backlog action.
     *
     * @param   {Request}   req Request object
     * @param   {Response}  res Response object
     */
    backlog: function(req, res) {
        var sprintId = parseInt(req.param("id"), 10);

        // Initialize view data object
        var data = {
            stories: false,
            role: 0,
            sprint: {
                data: false,
                progressStory: 0,
                progressTask: 0,
                cntStoryDone: 0,
                cntStoryNotDone: 0,
                cntStoryTotal: 0,
                cntTaskDone: 0,
                cntTaskNotDone: 0,
                cntTaskTotal: 0
            }
        };

        // Fetch basic data for backlog action parallel
        async.parallel(
            {
                // Fetch sprint data.
                sprint: function(callback) {
                    DataService.getSprint(sprintId, callback);
                },

                // Fetch sprint stories data.
                stories: function(callback) {
                    DataService.getStories({sprintId: sprintId}, callback);
                },

                // Determine user role in this sprint
                role: function(callback) {
                    AuthService.hasSprintAccess(req.user, sprintId, callback, true);
                }
            },

            /**
             * Callback function which is been called after all parallel jobs are processed.
             *
             * @param   {Error} error   Error object
             * @param   {{}}    result  Result object that contains 'sprint', 'stories' and 'role' data
             */
            function(error, result) {
                if (error) {
                    res.send(error.status ? error.status : 500, error);
                } else {
                    DataService.getPhases({projectId: result.sprint.projectId}, function(error, phases) {
                        if (error) {
                            res.send(error.status ? error.status : 500, error);
                        } else {
                            data.sprint.data = result.sprint;
                            data.stories = result.stories;
                            data.phases = phases;
                            data.role = result.role;

                            // Fetch task data
                            fetchPhaseDuration(data);
                        }
                    });
                }
            }
        );

        /**
         * Private function to fetch sprint task phase duration times. This will sum tasks durations
         * for each phase in this sprint.
         *
         * @param data
         */
        function fetchPhaseDuration(data) {
            async.map(
                data.phases,

                /**
                 * Function to determine duration in specified phase.
                 *
                 * @param   {sails.model.phase} phase
                 * @param   {Function}          callback
                 */
                function (phase, callback) {
                    PhaseDuration
                        .find({
                            sum: "duration"
                        })
                        .where({phaseId: phase.id})
                        .where({sprintId: data.sprint.data.id})
                        .done(function(error, result) {
                            if (error) {
                                callback(error, null);
                            } else {
                                phase.duration = result[0].duration ? result[0].duration : 0;

                                callback(null, phase.duration);
                            }
                        });
                },

                /**
                 * Main callback function which is called after all phases are processed.
                 *
                 * @param   {Error|null}    error
                 * @param   {{}}            result
                 */
                function (error, result) {
                    if (error) {
                        res.send(error, error.status ? error.status : 500);
                    } else {
                        fetchTaskData(data);
                    }
                }
            );
        }

        /**
         * Private function to fetch task data for each story in specified sprint.
         *
         * @return  void
         */
        function fetchTaskData(data) {
            // Calculate story specified statistics
            data.sprint.cntStoryTotal = data.stories.length;
            data.sprint.cntStoryDone = _.reduce(data.stories, function(memo, story) { return (story.isDone) ? memo + 1 : memo; }, 0);
            data.sprint.cntStoryNotDone = data.sprint.cntStoryTotal - data.sprint.cntStoryDone;

            if (data.sprint.cntStoryDone > 0) {
                data.sprint.progressStory = Math.round(data.sprint.cntStoryDone / data.sprint.cntStoryTotal * 100);
            } else {
                data.sprint.progressStory = 0;
            }

            // Map each sprint story and fetch task data of those
            async.map(
                data.stories,

                /**
                 * Iterator function which will fetch all tasks that are attached to current
                 * story and calculates some statistics data for story and sprint data.
                 *
                 * @param   {sails.model.story} story       Story object
                 * @param   {Function}          callback    Callback function to call after job is finished
                 */
                function(story, callback) {
                    Task
                        .find()
                        .where({
                            storyId: story.id
                        })
                        .sort("title ASC")
                        .done(function(error, tasks) {
                            if (error) {
                                callback(error, false);
                            } else {
                                // Add tasks to story data
                                story.tasks = tasks;
                                story.doneTasks = _.reduce(tasks, function(memo, task) { return (task.isDone) ? memo + 1 : memo; }, 0);

                                if (story.doneTasks > 0) {
                                    story.progress = Math.round(story.doneTasks / tasks.length * 100);
                                } else {
                                    story.progress = 0;
                                }

                                // Add task counts to sprint
                                data.sprint.cntTaskTotal += story.tasks.length;
                                data.sprint.cntTaskDone += story.doneTasks;

                                callback(null, true);
                            }
                        });
                },

                /**
                 * Callback function which is been called after all stories are processed.
                 *
                 * @param   {Error}     error   Error object
                 * @param   {Boolean}   result
                 */
                function(error, result) {
                    if (error) {
                        res.send(error.status ? error.status : 500, error);
                    } else {
                        data.sprint.cntTaskNotDone = data.sprint.cntTaskTotal - data.sprint.cntTaskDone;

                        if (data.sprint.cntTaskDone > 0) {
                            data.sprint.progressTask = Math.round(data.sprint.cntTaskDone / data.sprint.cntTaskTotal * 100);
                        } else {
                            data.sprint.progressTask = 0;
                        }

                        var totalTime = _.pluck(data.phases, "duration").reduce(function(memo, i) {return memo + i});
                        var totalTimeNoFirst = _.pluck(_.reject(data.phases, function(phase) { return phase.order === 0 } ), "duration").reduce(function(memo, i) {return memo + i});

                        data.phaseDuration = {
                            totalTime: totalTime,
                            totalTimeNoFirst: totalTimeNoFirst
                        };

                        _.each(data.phases, function(phase) {
                            phase.durationPercentage = (phase.duration > 0 && phase.order !== 0) ? phase.duration / totalTimeNoFirst * 100 : 0;
                            phase.durationPercentageTotal = (phase.duration > 0) ? phase.duration / totalTime * 100 : 0;
                        });

                        res.view(data);
                    }
                }
            )
        }
    },

    /**
     * Sprint charts action.
     *
     * @param   {Request}   req Request object
     * @param   {Response}  res Response object
     */
    charts: function(req, res) {
        var sprintId = parseInt(req.param("id"), 10);

        var data = {};

        // Get sprint and attached stories data
        async.parallel(
            {
                // Fetch sprint data
                sprint: function(callback) {
                    DataService.getSprint(sprintId, callback);
                },

                // Fetch sprint exclude days
                excludeDays: function(callback) {
                    DataService.getSprintExcludeDays(sprintId, callback);
                },

                // Fetch stories that are attached to this sprint
                stories: function(callback) {
                    DataService.getStories({sprintId: sprintId}, callback);
                }
            },

            /**
             * Callback function which is been called after all parallel jobs are processed.
             *
             * @param   {Error} error   Error object
             * @param   {{}}    results Result data as an object that contains 'sprint' and 'stories'
             */
            function(error, results) {
                if (error) {
                    res.send(error.status ? error.status : 500, error);
                } else {
                    // Store results to data
                    data.sprint = results.sprint;
                    data.stories = results.stories;
                    data.excludeDays = results.excludeDays;

                    getTasks();
                }
            }
        );

        /**
         * Private function to fetch all task data that are attached specified sprint.
         */
        function getTasks() {
            // Determine story id values for task search.
            var storyIds = _.map(data.stories, function(story) { return {storyId: story.id}; });

            if (storyIds.length > 0) {
                // Fetch stories tasks
                DataService.getTasks({or: storyIds}, function(error, tasks) {
                    if (error) {
                        res.send(error.status ? error.status : 500, error);
                    } else {
                        data.tasks = tasks;

                        res.view(data);
                    }
                });
            } else {
                data.tasks = [];

                res.view(data);
            }
        }
    },

    /**
     * Sprint chartDataTask action.
     *
     * @param   {Request}   req Request object
     * @param   {Response}  res Response object
     */
    chartDataTasks: function(req, res) {
        var sprintId = parseInt(req.param("sprintId"), 10);
        var data = {};

        // Get sprint and attached stories data
        async.parallel(
            {
                // Fetch sprint data
                sprint: function(callback) {
                    DataService.getSprint(sprintId, callback);
                },

                // Fetch sprint exclude days
                excludeDays: function(callback) {
                    DataService.getSprintExcludeDays(sprintId, callback);
                },

                // Fetch stories that are attached to this sprint
                stories: function(callback) {
                    DataService.getStories({sprintId: sprintId}, callback);
                },

                // Fetch task types
                types: function(callback) {
                    DataService.getTypes({}, callback);
                }
            },

            /**
             * Callback function which is been called after all parallel jobs are processed.
             *
             * @param   {Error} error   Error object
             * @param   {{}}    results Result data as an object that contains 'sprint' and 'stories'
             */
            function(error, results) {
                if (error) {
                    res.send(error.status ? error.status : 500, error.message ? error.message : error);
                } else {
                    // Store results to data
                    data.sprint = results.sprint;
                    data.excludeDays = results.excludeDays;
                    data.stories = results.stories;
                    data.types = results.types;

                    getTaskData();
                }
            }
        );

        /**
         * Private function to fetch task data.
         */
        function getTaskData() {
            async.parallel(
                {
                    // Fetch project phases data
                    phases: function(callback) {
                        DataService.getPhases({projectId: data.sprint.projectId}, callback);
                    },

                    // Fetch tasks that are attached to this sprint
                    tasks: function(callback) {
                        // Determine story id values for task search.
                        var storyIds = _.compact(_.map(data.stories, function(story) {
                            return story.ignoreInBurnDownChart ? false : {storyId: story.id};
                        }));

                        if (storyIds.length > 0) {
                            DataService.getTasks({or: storyIds}, callback);
                        } else {
                            callback(null, []);
                        }
                    }
                },

                /**
                 * Main callback function which is called after all parallel jobs are done.
                 *
                 * @param   {Error|null}    error
                 * @param   {{}}            results
                 */
                function(error, results) {
                    if (error) {
                        res.send(error.status ? error.status : 500, error.message ? error.message : error);
                    } else {
                        data.phases = results.phases;
                        data.tasks = _.sortBy(results.tasks, function(task) { return task.timeEnd; } );
                        data.tasksDone = _.filter(data.tasks, function(task) { return task.isDone; } );

                        fetchTaskDuration();
                    }
                }
            );
        }

        /**
         * Private function to determine tasks durations in each phase.
         */
        function fetchTaskDuration() {
            async.map(
                data.phases,

                /**
                 * Function to determine duration in current phase.
                 *
                 * @param   {sails.model.phase} phase
                 * @param   {Function}          callback
                 */
                function (phase, callback) {
                    PhaseDuration
                        .find({
                            sum: "duration"
                        })
                        .where({phaseId: phase.id})
                        .where({sprintId: data.sprint.id})
                        .done(function(error, result) {
                            if (error) {
                                callback(error, null);
                            } else {
                                phase.duration = result[0].duration ? result[0].duration : 0;

                                callback(null, phase.duration);
                            }
                        });
                },

                /**
                 * Main callback function which is called after all phases are processed.
                 *
                 * @param   {Error|null}    error
                 * @param   {{}}            result
                 */
                function (error, result) {
                    if (error) {
                        res.send(error.status ? error.status : 500, error.message ? error.message : error);
                    } else {
                        var totalTime = _.pluck(data.phases, "duration").reduce(function(memo, i) {return memo + i});
                        var totalTimeNoFirst = _.pluck(_.reject(data.phases, function(phase) { return phase.order === 0 } ), "duration").reduce(function(memo, i) {return memo + i});

                        data.phaseDuration = {
                            totalTime: totalTime,
                            totalTimeNoFirst: totalTimeNoFirst
                        };

                        _.each(data.phases, function(phase) {
                            phase.durationPercentage = (phase.duration > 0 && phase.order !== 0) ? phase.duration / totalTimeNoFirst * 100 : 0;
                            phase.durationPercentageTotal = (phase.duration > 0) ? phase.duration / totalTime * 100 : 0;
                        });

                        data.chartDataPhases = [];
                        data.chartDataPhasesTotal = [];

                        _.each(data.phases, function(phase) {
                            if (phase.durationPercentage > 0) {
                                data.chartDataPhases.push({
                                    name: phase.title,
                                    color: phase.backgroundColor,
                                    y: phase.durationPercentage,
                                    duration: phase.duration
                                });
                            }

                            if (phase.durationPercentageTotal > 0) {
                                data.chartDataPhasesTotal.push({
                                    name: phase.title,
                                    color: phase.backgroundColor,
                                    y: phase.durationPercentageTotal,
                                    duration: phase.duration
                                });
                            }
                        });

                        parseData();
                    }
                }
            );
        }

        /**
         * Private function to parse actual data for chart.
         */
        function parseData() {
            var initTasks = 0;
            var storyTasks = 0;
            var tasksOver = [];
            var taskCount = _.size(data.tasks);
            var taskTypes = _.groupBy(data.tasks, function(task) { return task.typeId; } );

            data.chartDataTaskTypes = [];

            _.each(taskTypes, function(tasks, typeId) {
                var type = _.find(data.types, function(type) { return type.id == typeId; });
                var count = _.size(tasks);

                if (count > 0) {
                    data.chartDataTaskTypes.push({
                        name: type.title,
                        color: type.chartColor,
                        y: count / taskCount * 100,
                        count: count
                    });
                }
            });

            // Iterate each stories and determine initial and "over" tasks
            _.each(data.stories, function(story) {
                storyTasks = 0;

                // Story has not yet started, so all of its tasks are in "init" data
                if (!(story.timeStart && story.timeStart != '0000-00-00 00:00:00')) {
                    storyTasks = _.size(_.filter(data.tasks, function(task) {
                        return task.storyId === story.id;
                    }));
                } else { // Otherwise story is either in process or done
                    // calculate task count that are created before story start time
                    storyTasks = _.size(_.filter(data.tasks, function(task) {
                        return (task.storyId === story.id && task.createdAt <= story.timeStart);
                    }));

                    // Determine tasks that are added after story start
                    tasksOver = tasksOver.concat(_.filter(data.tasks, function(task) {
                        return (task.storyId === story.id && task.createdAt > story.timeStart);
                    }));
                }

                // Add current story init task count to main task count
                initTasks = initTasks + storyTasks;
            });

            data.tasksOver = _.sortBy(tasksOver, function(task) { return task.createdAt; } );
            data.initTasks = initTasks;
            data.chartData = [];

            // Initialize statistics data
            data.statistics = {
                sprintDays: 0,
                workDays: 0,
                tasksPerDayIdeal: 0,
                tasksPerDayActual: 0
            };

            var dataActual = getActualData();

            data.pointStart = data.sprint.dateStartObject();
            data.pointActual = moment(_.last(dataActual).x);

            // Add 'Ideal task remaining' data
            data.chartData.push({
                name: "Ideal",
                nameShort: "Ideal",
                type: "spline",
                color: "#3276b1",
                dashStyle: "Dash",
                marker: {
                    enabled: false,
                    radius: 3
                },
                lineWidth: 1,
                zIndex: 10,
                data: getIdealData()
            });

            // Add 'Actual task remaining' data
            data.chartData.push({
                name: "Actual",
                nameShort: "Actual",
                type: "spline",
                color: "#c9302c",
                shadow: true,
                marker: {
                    enabled: false,
                    radius: 3
                },
                zIndex: 20,
                data: dataActual
            });

            // Add 'Done tasks' data
            data.chartData.push({
                name: "Done",
                nameShort: "Done",
                type: "column",
                color: "#47a447",
                zIndex: 5,
                data: getDoneData()
            });

            // Add 'Added tasks' data
            data.chartData.push({
                name: "Added",
                nameShort: "Added",
                type: "column",
                color: "#ec971f",
                zIndex: 0,
                data: getAddedData()
            });

            res.json(data);
        }

        /**
         * Private function to determine ideal data for charts. This is basically linear line where
         * start point is at sprint start and value for that point is sprint initial task count. End
         * point is at sprint end and value is zero.
         *
         * Output is an array of UTC date times and actual values.
         *
         * @returns {Array}
         */
        function getIdealData() {
            var output = [];
            var tasks = data.initTasks;
            var startTime = data.sprint.dateStartObject();
            var endTime = data.sprint.dateEndObject();
            var days = data.sprint.durationDays();

            // Used dates within calculations
            var currentDate = moment(startTime);
            var previousDate = Date.UTC(startTime.year(), startTime.month(), startTime.date());

            // Iterate sprint date range and remove exclude days
            while (endTime.diff(currentDate, "days") > 0) {
                // Exclude day founded, so decrease total day count
                if (_.find(data.excludeDays, function(day) { return currentDate.isSame(day.dayObject(), "days"); })) {
                    days = days - 1;
                }

                currentDate.add("days", 1);
            }

            // Calculate ideal tasks per day count
            var tasksPerDay = data.initTasks / (days - 1);

            // Store statistics data
            data.statistics.sprintDays = days;
            data.statistics.tasksPerDayIdeal = tasksPerDay;

            // Set current date to sprint start
            currentDate = moment(startTime);

            // Iterate sprint days and make ideal line data
            while (endTime.diff(currentDate, "days") > 0) {
                var ignore = isDateIgnored(currentDate);

                // Current date is valid for ideal line data
                if (!ignore) {
                    // Add data to output
                    output.push({
                        x: Date.UTC(currentDate.year(), currentDate.month(), currentDate.date()),
                        y: tasks,
                        previousX: previousDate ? previousDate : null,
                        notPlannedDay: false
                    });

                    // Store new previous date and task count for next round
                    previousDate = Date.UTC(currentDate.year(), currentDate.month(), currentDate.date());
                    tasks = tasks - tasksPerDay;
                }

                currentDate.add("days", 1);
            }

            // Add final point for ideal line
            output.push({
                x: Date.UTC(currentDate.year(), currentDate.month(), currentDate.date()),
                y: 0,
                previousX: previousDate ? previousDate : null,
                notPlannedDay: false
            });

            return output;
        }

        /**
         * Private function to get actual task data.
         *
         * @returns {Array}
         */
        function getActualData() {
            var output = [];
            var tasks = data.initTasks;
            var startTime = data.sprint.dateStartObject();
            var endTime = data.sprint.dateEndObject();
            var tasksDone = 0;
            var tasksOver = 0;
            var workDays = 0;

            // Used dates within calculations
            var currentDate = moment(startTime);
            var previousDate = Date.UTC(startTime.year(), startTime.month(), startTime.date());

            // Add first point of data
            output.push({
                x: Date.UTC(currentDate.year(), currentDate.month(), currentDate.date()),
                y: tasks,
                previousX: previousDate,
                notPlannedDay: isDateIgnored(currentDate)
            });

            // Group tasks for calculations
            var objectsTasksDone = _.groupBy(data.tasks, function(task) {
                return task.isDone ? task.timeEndObject().format("YYYY-MM-DD") : null;
            });

            var objectsTasksOver = _.groupBy(data.tasksOver, function(task) {
                return task.createdAtObject().format("YYYY-MM-DD");
            });

            // Iterate dates
            while (endTime.diff(currentDate, "days") >= 0) {
                // We are only interested days that are before current day
                if (currentDate.isBefore(moment().add("days", 1), "day")) {
                    // Determine if current date is ignored or not
                    var ignore = isDateIgnored(currentDate);
                    var date = currentDate.format("YYYY-MM-DD");
                    var notPlannedDay = false;

                    // Determine tasks count
                    tasksDone = objectsTasksDone[date] ? _.size(objectsTasksDone[date]) : 0;
                    tasksOver = objectsTasksOver[date] ? _.size(objectsTasksOver[date]) : 0;

                    // If current date has some tasks done or added, we must drawn this date
                    if (tasksDone > 0 || tasksOver > 0) {
                        notPlannedDay = ignore;
                        ignore = false;
                    }

                    // Date is valid to show
                    if (!ignore) {
                        // Calculate new task count based to previous tasks, done and added tasks count
                        tasks = tasks - tasksDone + tasksOver;

                        // Add new point data to output
                        output.push({
                            x: Date.UTC(currentDate.year(), currentDate.month(), currentDate.date()),
                            y: tasks,
                            previousX: previousDate ? previousDate : null,
                            notPlannedDay: notPlannedDay
                        });

                        // Add workdays
                        workDays = workDays + 1;

                        // Store new previous date
                        previousDate = Date.UTC(currentDate.year(), currentDate.month(), currentDate.date());
                    }
                }

                // Go to next date
                currentDate.add("days", 1);
            }

            // We have some tasks not done, this means that sprint has failed somehow
            if (tasks > 0) {
                // Loop days until we have today.
                while (moment().diff(currentDate, "days") >= 0 && tasks > 0) {
                    // We are only interested days that are before current day
                    if (currentDate.isBefore(moment().add("days", 1), "day")) {
                        ignore = isDateIgnored(currentDate);
                        date = currentDate.format("YYYY-MM-DD");

                        // Determine tasks count
                        tasksDone = objectsTasksDone[date] ? _.size(objectsTasksDone[date]) : 0;
                        tasksOver = objectsTasksOver[date] ? _.size(objectsTasksOver[date]) : 0;

                        // If current date has some tasks done or added, we must drawn this date
                        if (tasksDone > 0 || tasksOver > 0) {
                            ignore = false;
                        }

                        // Date is valid to show
                        if (!ignore) {
                            // Calculate new task count based to previous tasks, done and added tasks count
                            tasks = tasks - tasksDone + tasksOver;

                            // Add point data to output
                            output.push({
                                x: Date.UTC(currentDate.year(), currentDate.month(), currentDate.date()),
                                y: tasks,
                                previousX: previousDate ? previousDate : null,
                                notPlannedDay: true
                            });

                            // Add workdays
                            workDays = workDays + 1;

                            // Store new previous date
                            previousDate = Date.UTC(currentDate.year(), currentDate.month(), currentDate.date());
                        }
                    }

                    // Go to next date
                    currentDate.add("days", 1);
                }
            }

            // Store statistics data
            data.statistics.workDays = workDays;
            data.statistics.tasksPerDayActual = data.tasksDone.length / workDays;

            return output;
        }

        /**
         * Private function to get possible added task data for current sprint.
         *
         * @returns {Array}
         */
        function getAddedData() {
            var output = [];

            // Group task data by create date and iterate grouped data
            _.each(_.groupBy(data.tasksOver, function(task) { return task.createdAtObject().format("YYYY-MM-DD"); } ),
                function(tasks) {
                    //var date = tasks[0].createdAtObject().add("days", 1);
                    var date = tasks[0].createdAtObject();

                    output.push([Date.UTC(date.year(), date.month(), date.date()), _.size(tasks)]);
                }
            );

            return output;
        }

        /**
         * Private function to get done data for current sprint.
         *
         * @returns {Array}
         */
        function getDoneData() {
            var output = [];

            // Group task data by done date and iterate grouped data
            _.each(_.groupBy(data.tasksDone, function(task) { return task.timeEndObject().format("YYYY-MM-DD"); }),
                function(tasks) {
                    //var date = tasks[0].timeEndObject().add("days", 1);
                    var date = tasks[0].timeEndObject();

                    output.push([Date.UTC(date.year(), date.month(), date.date()), _.size(tasks)]);
                }
            );

            return output;
        }

        /**
         * Private function to determine if given date is ignored in sprint or not.
         *
         * @param   {moment}    momentObject
         * @returns {boolean}
         */
        function isDateIgnored(momentObject) {
            var ignore = false;

            // Sprint doesn't contain weekends
            if (data.sprint.ignoreWeekends) {
                var weekDay = momentObject.isoWeekday();

                if (weekDay === 6 || weekDay === 7) {
                    ignore = true;
                }
            }

            // Also ignore date if it is exclude day in sprint
            if (_.find(data.excludeDays, function(day) { return momentObject.isSame(day.dayObject(), "days"); })) {
                ignore = true;
            }

            return ignore;
        }
    }
};
