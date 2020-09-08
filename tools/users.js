'use strict';

const { getModel } = require('./database').model;
const dbQuery = require('./database').query;
const { has, omit, pick, each } = require('lodash');
const { isEmail } = require('validator');
const { SERVER_PATH, SETTING_KEYS, OMITTED_USER_FIELDS, DEFAULT_ORDER_RISK_PERCENTAGE } = require('../constants');
const { SIGNUP_NOT_AVAILABLE, PROVIDE_VALID_EMAIL, USER_EXISTS, INVALID_PASSWORD, INVALID_VERIFICATION_CODE, USER_NOT_FOUND } = require('../messages');
const { getFrozenUsers } = require(`${SERVER_PATH}/init`);
const { publisher } = require('./database/redis');
const { INIT_CHANNEL, ADMIN_ACCOUNT_ID } = require(`${SERVER_PATH}/constants`);
const { sendEmail } = require(`${SERVER_PATH}/mail`);
const { MAILTYPE } = require(`${SERVER_PATH}/mail/strings`);
const { getKit, getSecrets, getKitCoinsConfig, getKitCoins, getKitCoin, getPairs, getNodeLib } = require(`${SERVER_PATH}/init`);
const { all } = require('bluebird');
const { Op } = require('sequelize');
const { paginationQuery, timeframeQuery, orderingQuery } = require('./database/helpers');
const { parse } = require('json2csv');
const flatten = require('flat');

const signUpUser = (email, password, referral) => {
	if (!getKit().new_user_is_activated) {
		throw new Error(SIGNUP_NOT_AVAILABLE);
	}

	if (!email || !isEmail(email)) {
		throw new Error(PROVIDE_VALID_EMAIL);
	}

	if (!isValidPassword(password)) {
		throw new Error(INVALID_PASSWORD);
	}

	return dbQuery.findOne('user', {
		where: { email: email.toLowerCase() },
		attributes: ['email']
	})
		.then((user) => {
			if (user) {
				throw new Error(USER_EXISTS);
			}
			return getModel('user').create({
				email,
				password,
				settings: INITIAL_SETTINGS()
			});
		})
		.then((user) => {
			return all([
				getVerificationCodeByUserId(user.id),
				user
			]);
		})
		.then(([ verificationCode, user ]) => {
			sendEmail(
				MAILTYPE.SIGNUP,
				email,
				verificationCode.code,
				{}
			);
			if (referral) {
				checkAffiliation(referral, user.id);
			}
			return user;
		});
};

const verifyUser = (email, code) => {
	return getModel('sequelize').transaction((transaction) => {
		return dbQuery.findOne('user',
			{ where: { email } },
			{ transaction }
		)
			.then((user) => {
				return all([
					dbQuery.findOne('verification code',
						{
							where: { user_id: user.id },
							attributes: ['id', 'code', 'verified', 'user_id']
						},
						{ transaction }
					),
					user
				]);
			})
			.then(([ verificationCode, user ]) => {
				if (verificationCode.verified) {
					throw new Error('User is verified');
				}
				if (code !== verificationCode.code) {
					throw new Error(INVALID_VERIFICATION_CODE);
				}
				return all([
					user,
					getNodeLib().createUserNetwork(email),
					code.update({ verified: true }, { returning: true, transaction })
				]);
			})
			.then(([ user, networkUser ]) => {
				return user.update({
					network_id: networkUser.id
				}, { returning: true, transaction });
			});
	});
};

const isValidPassword = (value) => {
	return /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/.test(value);
};

const getVerificationCodeByUserEmail = (email) => {
	return getUserByEmail(email)
		.then((user) => {
			return getVerificationCodeByUserId(user.id);
		});
};

const getVerificationCodeByUserId = (user_id) => {
	return dbQuery.findOne('verification code', {
		where: { user_id },
		attributes: ['id', 'code', 'verified', 'user_id']
	}).then((verificationCode) => {
		if (verificationCode.verified) {
			throw new Error('User is verified');
		}
		return verificationCode;
	});
};

const getUserByAffiliationCode = (affiliationCode) => {
	const code = affiliationCode.toUpperCase().trim();
	return dbQuery.finOne('user', {
		where: { affiliation_code: code },
		attributes: ['id', 'email', 'affiliation_code']
	});
};

const checkAffiliation = (affiliationCode, user_id) => {
	let discount = 0; // default discount rate in percentage
	return getUserByAffiliationCode(affiliationCode)
		.then((referrer) => {
			if (getSecrets().plugins.affiliation && getSecrets().plugins.affiliation.discount) {
				discount = getSecrets().plugins.affiliation.discount;
			}

			return getModel('affiliation').create({
				user_id,
				referer_id: referrer.id
			});
		})
		.then((affiliation) => {
			return getModel('user').update(
				{
					discount
				},
				{
					where: {
						id: affiliation.user_id
					},
					fields: ['discount']
				}
			);
		});
};

/**
 *
 * @param {object} user - User object
 * @return {object}
 */
const omitUserFields = (user) => {
	return omit(user, OMITTED_USER_FIELDS);
};

const getAllUsers = () => {
	return dbQuery.findAll('user', {
		attributes: {
			exclude: OMITTED_USER_FIELDS
		}
	});
};

const getAllUsersAdmin = (id, search, pending, limit, page, order_by, order, start_date, end_date, format) => {
	const pagination = paginationQuery(limit, page);
	const timeframe = timeframeQuery(start_date, end_date);
	const ordering = orderingQuery(order_by, order);
	let query = {
		where: {}
	};
	if (id || search) {
		query.attributes = {
			exclude: ['balance', 'password', 'updated_at']
		};
		if (id) {
			query.where.id = id;
		} else {
			query.where = {
				$or: [
					{
						email: {
							[Op.like]: `%${search}%`
						}
					},
					{
						username: {
							[Op.like]: `%${search}%`
						}
					},
					{
						full_name: {
							[Op.like]: `%${search}%`
						}
					},
					{
						phone_number: {
							[Op.like]: `%${search}%`
						}
					},
					getModel('sequelize').literal(`id_data ->> 'number'='${search}'`),
					...getKitCoins().map((coin) => getModel('sequelize').literal(`crypto_wallet ->> '${coin}'='${search}'`))
				]
			};
		}
	} else if (pending) {
		query = {
			where: {
				$or: [
					getModel('sequelize').literal('bank_account @> \'[{"status":1}]\''),
					{
						id_data: {
							status: 1
						}
					},
					{
						activated: false
					}
				]
			},
			attributes: [
				'id',
				'email',
				'verification_level',
				'id_data',
				'bank_account',
				'activated'
			],
			order: ordering ? [ordering] : [['updated_at', 'desc']]
		};
	} else {
		query = {
			where: {},
			attributes: {
				exclude: ['password', 'is_admin', 'is_support', 'is_supervisor', 'is_kyc', 'is_tech']
			},
			include: [
				{
					model: getModel('balance'),
					as: 'balance',
					attributes: {
						exclude: ['id', 'user_id', 'created_at']
					}
				}
			],
			order: ordering ? [ordering] : [['id', 'desc']]
		};
	}
	if (timeframe) query.where.created_at = timeframe;
	if (!format) {
		query = {...query, ...pagination};
	} else if (!pending) {
		query.attributes.exclude.push('settings');
	}
	return dbQuery.findAndCountAllWithRows('user', query)
		.then(({ count, data }) => {
			if ((id || search) && count === 0) {
				if (count === 0) {
					// Need to throw error if query was for one user and the user is not found
					const error = new Error(USER_NOT_FOUND);
					error.status = 404;
					throw error;
				}
			}

			return { count, data };
		})
		.then((users) => {
			if (format.value) {
				if (users.data.length === 0) {
					throw new Error('No data found');
				}
				const flatData = users.data.map((user) => {
					let crypto_wallet;
					let id_data;
					if (user.balance) {
						user.balance = user.balance.dataValues;
					} else {
						delete user.balance;
					}
					if (user.crypto_wallet) {
						crypto_wallet = user.crypto_wallet;
						user.crypto_wallet = {};
					}
					if (user.id_data) {
						id_data = user.id_data;
						user.id_data = {};
					}
					const result = flatten(user, { safe: true });
					if (crypto_wallet) result.crypto_wallet = crypto_wallet;
					if (id_data) result.id_data = id_data;
					return result;
				});
				const csv = parse(flatData, Object.keys(flatData[0]));
				return csv;
			} else {
				return users;
			}
		});
};

const getUserByCryptoAddress = (currency, address) => {
	if (!currency || !address) {
		throw new Error('Please provide the user\'s currency and crypto address');
	}
	return dbQuery.findOne('user', {
		where: { crypto_wallet: { [currency]: address } }
	});
};

const getUser = (opts = {}, rawData = true) => {
	if (!opts.email && !opts.kit_id && !opts.network_id) {
		throw new Error('Please provide the user\'s kit id, network id, or email');
	}

	const where = {};
	if (opts.email) {
		where.email = opts.email;
	} else if (opts.kit_id) {
		where.id = opts.kit_id;
	} else {
		where.network_id = opts.network_id;
	}

	return dbQuery.findOne('user', {
		where,
		raw: rawData
	})
		.then((user) => {
			if (!user) {
				throw new Error('User does not exist');
			} else {
				return user;
			}
		});
};

const getUserByEmail = (email, rawData = true) => {
	if (!email || !isEmail(email)) {
		throw new Error('Please provide a valid email address');
	}
	return getUser({ email }, rawData);
};

const getUserByKitId = (kit_id, rawData = true) => {
	if (!kit_id) {
		throw new Error('Please provide a kit id');
	}
	return getUser({ kit_id }, rawData);
};

const getUserByNetworkId = (network_id, rawData = true) => {
	if (!network_id) {
		throw new Error('Please provide a network id');
	}
	return getUser({ network_id }, rawData);
};

const freezeUserById = (userId) => {
	if (userId === ADMIN_ACCOUNT_ID) {
		throw new Error('Admin account cannot be deactivated');
	}
	return getUserByKitId(userId, false)
		.then((user) => {
			if (!user.activated) {
				throw new Error('User account is already frozen');
			}
			return user.update({ activated: false }, { fields: ['activated'], returning: true });
		})
		.then((user) => {
			publisher.publish(INIT_CHANNEL, JSON.stringify({type: 'freezeUser', data: user.id }));
			sendEmail(
				MAILTYPE.USER_DEACTIVATED,
				user.email,
				{
					type: 'deactivated'
				},
				user.settings
			);
			return user;
		});
};

const freezeUserByEmail = (email) => {
	return getUserByEmail(email, false)
		.then((user) => {
			if (user.id === ADMIN_ACCOUNT_ID) {
				throw new Error('Admin account cannot be deactivated');
			}
			if (!user.activated) {
				throw new Error('User account is already frozen');
			}
			return user.update({ activated: false }, { fields: ['activated'], returning: true });
		})
		.then((user) => {
			publisher.publish(INIT_CHANNEL, JSON.stringify({type: 'freezeUser', data: user.id }));
			sendEmail(
				MAILTYPE.USER_DEACTIVATED,
				user.email,
				{
					type: 'deactivated'
				},
				user.settings
			);
			return user;
		});
};

const unfreezeUserById = (userId) => {
	return getUserByKitId(userId, false)
		.then((user) => {
			if (user.activated) {
				throw new Error('User account is not frozen');
			}
			return user.update({ activated: true }, { fields: ['activated'], returning: true });
		})
		.then((user) => {
			publisher.publish(INIT_CHANNEL, JSON.stringify({type: 'unfreezeUser', data: user.id }));
			sendEmail(
				MAILTYPE.USER_DEACTIVATED,
				user.email,
				{
					type: 'activated'
				},
				user.settings
			);
			return user;
		});
};

const unfreezeUserByEmail = (email) => {
	return getUserByEmail(email, false)
		.then((user) => {
			if (user.activated) {
				throw new Error('User account is not frozen');
			}
			return user.update({ activated: true }, { fields: ['activated'], returning: true  });
		})
		.then((user) => {
			publisher.publish(INIT_CHANNEL, JSON.stringify({type: 'unfreezeUser', data: user.id }));
			sendEmail(
				MAILTYPE.USER_DEACTIVATED,
				user.email,
				{
					type: 'activated'
				},
				user.settings
			);
			return user;
		});
};

const getUserRole = (opts = {}) => {
	return getUser(opts, true)
		.then((user) => {
			if (user.is_admin) {
				return 'admin';
			} else if (user.is_supervisor) {
				return 'supervisor';
			} else if (user.is_support) {
				return 'support';
			} else if (user.is_kyc) {
				return 'kyc';
			} else if (user.is_tech) {
				return 'tech';
			} else {
				return 'user';
			}
		});
};

const updateUserRole = (user_id, role) => {
	if (user_id === ADMIN_ACCOUNT_ID) {
		throw new Error('Cannot change main admin account role');
	}
	return dbQuery.findOne('user', {
		where: {
			id: user_id
		},
		attributes: [
			'id',
			'is_admin',
			'is_support',
			'is_supervisor',
			'is_kyc',
			'is_tech'
		]
	})
		.then((user) => {
			const roles = pick(
				user.dataValues,
				'is_admin',
				'is_supervisor',
				'is_support',
				'is_kyc',
				'is_tech'
			);

			const roleChange = 'is_' + role.toLowerCase();

			if (roles[roleChange]) {
				throw new Error (`User already has role ${role}`);
			}

			each(roles, (value, key) => {
				if (key === roleChange) {
					roles[key] = true;
				} else {
					roles[key] = false;
				}
			});

			return all([user, roles]);
		})
		.then(([user, roles]) => {
			return user.update(
				roles,
				{ fields: ['is_admin', 'is_support', 'is_supervisor', 'is_kyc', 'is_tech'], returning: true }
			);
		})
		.then((user) => {
			const result = pick(
				user,
				'id',
				'email',
				'is_admin',
				'is_support',
				'is_supervisor',
				'is_kyc',
				'is_tech'
			);
			return result;
		});
};

const DEFAULT_SETTINGS = {
	language: getKit().defaults.language,
	orderConfirmationPopup: true
};

const joinSettings = (userSettings = {}, newSettings = {}) => {
	const joinedSettings = {};
	SETTING_KEYS.forEach((key) => {
		if (has(newSettings, key)) {
			joinedSettings[key] = newSettings[key];
		} else if (has(userSettings, key)) {
			joinedSettings[key] = userSettings[key];
		} else {
			joinedSettings[key] = DEFAULT_SETTINGS[key];
		}
	});
	return joinedSettings;
};

const updateUserSettings = (opts = {}, settings = {}, rawData = true) => {
	return getUser(opts, false)
		.then((user) => {
			if (Object.keys(settings).length > 0) {
				settings = joinSettings(user.dataValues.settings, settings);
			}
			return user.update({ settings }, {
				fields: [
					'settings'
				],
				returning: true,
				raw: rawData
			});
		})
		.then((user) => {
			return user;
		});
};

const INITIAL_SETTINGS = () => {
	return {
		notification: {
			popup_order_confirmation: true,
			popup_order_completed: true,
			popup_order_partially_filled: true
		},
		interface: {
			order_book_levels: 10,
			theme: getKit().defaults.theme
		},
		language: getKit().defaults.language,
		audio: {
			order_completed: true,
			order_partially_completed: true,
			public_trade: false
		},
		risk: {
			order_portfolio_percentage: DEFAULT_ORDER_RISK_PERCENTAGE
		},
		chat: {
			set_username: false
		}
	};
};

const getUserEmailByVerificationCode = (code) => {
	return dbQuery.findOne('verification code', {
		where: { code },
		attributes: ['id', 'code', 'verified', 'user_id']
	})
		.then((verificationCode) => {
			if (!verificationCode) {
				throw new Error('Verification Code invalid');
			} else if (verificationCode.verified) {
				throw new Error('Verification Code used');
			}
			return dbQuery.findOne('user', {
				where: { id: verificationCode.user_id },
				attributes: ['email']
			});
		})
		.then((user) => {
			return user.email;
		});
};

const getUserBalanceByKitId = (userKitId) => {
	return getUserByKitId(userKitId)
		.then((user) => {
			return getNodeLib().getBalanceNetwork(user.network_id);
		});
};

const updateUserNote = (userId, note) => {
	return getUserByKitId(userId, false)
		.then((user) => {
			return user.update({ note }, { fields: ['note']});
		});
};

module.exports = {
	getUserByEmail,
	getUserByKitId,
	getUserByNetworkId,
	getUserByCryptoAddress,
	getFrozenUsers,
	freezeUserById,
	freezeUserByEmail,
	unfreezeUserById,
	unfreezeUserByEmail,
	getAllUsers,
	getUserRole,
	updateUserSettings,
	omitUserFields,
	signUpUser,
	verifyUser,
	getVerificationCodeByUserEmail,
	getUserEmailByVerificationCode,
	getUserBalanceByKitId,
	getAllUsersAdmin,
	updateUserRole,
	updateUserNote
};