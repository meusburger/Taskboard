/**
 * User
 *
 * @module      ::  Model
 * @description ::  Model to represents taskboard user.
 * @docs        ::  http://sailsjs.org/#!documentation/models
 */
"use strict";

var bcrypt = require("bcrypt");
var gravatar = require("gravatar");
var async = require("async");

/**
 * Generic password hash function.
 *
 * @param   {sails.model.user}  values
 * @param   {Function}          next
 */
function hashPassword(values, next) {
    bcrypt.hash(values.password, 10, function(err, hash) {
        if (err) {
            return next(err);
        }

        values.password = hash;

        return next();
    });
}

module.exports = {
    schema: true,
    attributes: {
        username: {
            type:       "string",
            required:   true,
            unique:     true
        },
        firstName: {
            type:       "string",
            required:   true
        },
        lastName: {
            type:       "string",
            required:   true
        },
        email: {
            type:       "email",
            required:   true,
            unique:     true
        },
        admin: {
            type:       "boolean",
            defaultsTo: false
        },
        password: {
            type:       "string",
            required:   false
        },
        language: {
            type:       "string",
            defaultsTo: "fi",
            required:   true
        },
        momentFormatDate: {
            type:       "string",
            defaultsTo: "L",
            required:   true
        },
        momentFormatTime: {
            type:       "string",
            defaultsTo: "LT",
            required:   true
        },
        momentFormatDateTime: {
            type:       "string",
            defaultsTo: "L LT",
            required:   true
        },
        momentTimezone: {
            type:       "string",
            defaultsTo: "Europe/Mariehamn",
            required:   true
        },
        taskTemplateChangeLimit: {
            type:       "integer",
            defaultsTo: 6,
            required:   true
        },
        boardSettingHideDoneStories: {
            type:       "boolean",
            defaultsTo: false,
            required:   true
        },
        sessionId: {
            type:       "string",
            defaultsTo: ""
        },
        createdUserId: {
            type:       "integer",
            required:   true
        },
        updatedUserId: {
            type:       "integer",
            required:   true
        },

        // Dynamic data attributes

        // Computed user fullName string
        fullName: function() {
            return this.lastName + " " + this.firstName;
        },

        // Gravatar image url
        gravatarImage: function(size) {
            size = size || 25;

            return gravatar.url(this.email, {s: size, r: "pg", d: "mm"}, true);
        },

        // ObjectTitle
        objectTitle: function() {
            return this.lastName + " " + this.firstName;
        },
        createdAtObject: function () {
            return (this.createdAt && this.createdAt != "0000-00-00 00:00:00")
                ? DateService.convertDateObjectToUtc(this.createdAt) : null;
        },
        updatedAtObject: function () {
            return (this.updatedAt && this.updatedAt != "0000-00-00 00:00:00")
                ? DateService.convertDateObjectToUtc(this.updatedAt) : null;
        },

        // Override toJSON instance method to remove password value
        toJSON: function() {
            var obj = this.toObject();
            delete obj.password;
            delete obj.sessionId;

            return obj;
        },

        // Validate password
        validPassword: function(password, callback) {
            var obj = this.toObject();

            if (callback) {
                return bcrypt.compare(password, obj.password, callback);
            } else {
                return bcrypt.compareSync(password, obj.password);
            }
        }
    },

    // Life cycle callbacks

    /**
     * Before create callback.
     *
     * @param   {sails.model.user}  values
     * @param   {Function}          next
     */
    beforeCreate: function(values, next) {
        hashPassword(values, next);
    },

    /**
     * Before update callback.
     *
     * @param   {sails.model.user}  values
     * @param   {Function}          next
     */
    beforeUpdate: function(values, next) {
        if (values.password) {
            hashPassword(values, next);
        } else if (values.id) {
            User
                .findOne(values.id)
                .done(function(err, user) {
                    if (err) {
                        next(err);
                    } else {
                        values.password = user.password;

                        // User try to make himself an administrator user, no-way-hose :D
                        if (values.admin && !user.admin) {
                            values.admin = false;
                        }

                        next();
                    }
                });
        } else {
            next();
        }
    },

    /**
     * After create callback.
     *
     * @param   {sails.model.user}  values
     * @param   {Function}          cb
     */
    afterCreate: function(values, cb) {
        HistoryService.write("User", values);

        cb();
    },

    /**
     * After update callback.
     *
     * @param   {sails.model.user}  values
     * @param   {Function}          cb
     */
    afterUpdate: function(values, cb) {
        HistoryService.write("User", values);

        cb();
    },

    /**
     * Before destroy callback.
     *
     * @param   {Object}    terms
     * @param   {Function}  cb
     */
    beforeDestroy: function(terms, cb) {
        User
            .findOne(terms)
            .done(function(error, user) {
                if (error) {
                    sails.log.error(error);
                } else {
                    HistoryService.remove("User", user.id);
                }

                cb();
            });
    }
};
