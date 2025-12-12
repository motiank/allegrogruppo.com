import { Strategy as LocalStrategy } from 'passport-local';
import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';

import users from "../sources/users.js";

const userApi = {
	findById: function (id, fn) {
		users.get( { "user_id": id }, function (db_res) {
			fn(db_res)
		});
	},

	findByEmail: function (email, fn) {
		console.log('About to query users by email');
		users.get( { "email": email }, function (db_res) {
			fn(db_res)
		});
	},
	register: function (user_, fn) {
		users.update( user_, function (err_, tpl_) {
			fn(err_, tpl_);
		});
	},
	setPassword: function (user_id, email, password, fn) {
		console.log("set password to: " + email);
		users.update( { "user_id": user_id, "password": password, "authKey": this.getUserKey(email, password) }, function (err_, tpl_) {
			fn(err_, tpl_)
		});
	},

	getUserKey: function (email, password_) {
		var base_string = email + "mtsecretcode2015" + password_;
		var shasum = crypto.createHash('md5');
		shasum.update(base_string, 'ascii')
		var hs_ = shasum.digest('hex');
		console.log("userkey_=" + hs_);
		return hs_;
	},
	getSecureFields: function () {
		return "user_idnameemailrolemanager_idinfo_jsontargeting_jsonstatus";
	},
	generatePassword: function () {
		var text = "";
		var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
		for (var i = 0; i < 8; i++)
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		return text;
	}
};

export const gateKeeper = function (req, res, next) {
	console.log('gateKeeper');
	if (req.isAuthenticated()) {
		console.log('gateKeeper Authenticated')
		return next();
	}

	console.log('gateKeeper guest')

	req.user = { user_id: 0, role: "guest" };
	next();

	// res.jsonp({ meta:{
	// 	resType:null,
	// 	err:'Not allowed!' 
	// }, user: req.user });

};

export const cookieSessionStorage = function (req, res, next) {
	//console.log('cookieSessionStorage');
	const algorithm = 'aes-256-gcm';
	const password = '3zTvzr3p67VC61jmV54rIYu1545x4TlY';
	// do not use a global iv for production, 
	// generate a new one for each encryption
	const iv = '60iP0h6vJoEa'

	function encrypt(text) {
		const cipher = crypto.createCipheriv(algorithm, password, iv)
		var encrypted = cipher.update(text, 'utf8', 'hex')
		encrypted += cipher.final('hex');
		var tag = cipher.getAuthTag();
		return {
			content: encrypted,
			tag: tag
		};
	}

	function decrypt(encrypted) {
		const decipher = crypto.createDecipheriv(algorithm, password, iv)
		decipher.setAuthTag(encrypted.tag);
		var dec = decipher.update(encrypted.content, 'hex', 'utf8')
		dec += decipher.final('utf8');
		return dec;
	}

	function setUserToCookie() {
		var user = req.user;
		if (user) {
			var ck_str = JSON.stringify({ user_id: user.user_id, email: user.email, role: user.role })
			var enc_ = encrypt(ck_str);
			res.cookie('user', JSON.stringify(enc_), { maxAge: 24 * 3600 * 1000, httpOnly: true });
		}
	};
	function getUserFromCookie() {
		var user_str = req.cookies["user"];
		if (user_str) {
			var enc_ = JSON.parse(user_str);
			enc_.tag = Buffer.from(JSON.parse(JSON.stringify(enc_.tag)).data)
			var dec_ = decrypt(enc_)
			req.user = JSON.parse(dec_);
		}
		setUserToCookie();
	}

	if (req.user) {
		setUserToCookie();
	} else {
		getUserFromCookie();
	}

	//console.log('cookieSessionStorage next()');
	next();
};

export const router = function (passport) {
	passport.use(new LocalStrategy({ session: false }, function (username, password, done) {
		process.nextTick(function () {
			console.log('router.process.nextTick');
			userApi.findByEmail(username, function (db_res) {
				console.log('Find by email ' + username);
				var res_ = db_res.getRes();
				if (res_.meta.err) { return done(res_.meta.err); }
				var user = db_res.getRes().rows[0];

				if (user) {
					if (user.authKey != userApi.getUserKey(username, password)) {
						if (user.password != "" && user.authKey == "") {
							userApi.setPassword(user.user_id, user.email, user.password, function (err_, tpl_) {
								return done(null, false, { message: 'old format is converted - pls retry' });
							});
						} else {
							return done(null, false, { message: 'Unknown user name or wrong password ' });
						}
					} else {
						user.fullRecord = true;
						return done(null, user);
					}
				} else {
					return done(null, false, { message: 'Unknown user name or wrong password ' });
				}
			})
		});
	}));

	var router = express.Router();

	function authResponse(req, res) {
		console.log("authResponse")
		var obj = { meta: { resVer: "1", resType: "content" }, content: {} }
		if (req.flash)
			obj.flash_error = req.flash('error');

		if (req.isAuthenticated()) {
			var user_ = req.user;
			if (user_) {
				if (user_.fullRecord) {
					obj.content.status = 'logged-in';
					obj.content.user = user_;
					res.jsonp(obj);
				} else {
					users.get( { id: user_.user_id }, function (db_res) {
						var res_ = db_res.getRes();
						if (res_.meta && res_.meta.err) {
							obj.meta.err = res_.meta.err;
							obj.content.status = 'logged-out';
							res.jsonp(obj);
						} else {
							obj.content.status = 'logged-in';
							obj.content.user = res_.rows[0];
							res.jsonp(obj);
						}
					});
				}
				return;
			}
		}

		if (req.err)
			obj.meta.err = req.err;
		obj.content.status = 'logged-out';
		res.jsonp(obj);
	};

	router.post('/login',
		passport.authenticate('local', {
			session: false, failureRedirect: '/login',
			failureFlash: false
		}), cookieSessionStorage, authResponse);

	router.get('/login', cookieSessionStorage, authResponse);

	router.get('/logout', function (req, res, next) {
		console.log("logging out")
		req.logout();
		res.clearCookie('user', { path: '/' });
		next();
	}, authResponse);

	router.post('/register', function (req, res, next) {
		console.log('register');
		console.log(req.body);
		if (req.body.email) {
			userApi.register(req.body, function (err_, tpl_) {
				if (err_) {
					res.json({ err: err_ });
				} else {
					var res_ = tpl_.getRes();
					res.json({ user: res_.rows[0] });
				}
			})
		} else {
			res.json({ err: "email is missing" });
		}
	});

	router.post('/changePassword', function (req, res, next) {
		console.log('changePassword');
		console.log(req.body); //email, old password, password		
		if (req.body.email) {
			userApi.findByEmail(req.body.email, function (db_res) {
				console.log('changePassword Find by email');
				var res_ = db_res.getRes();
				if (res_.meta.err) { 
					res.json({ errCode: 103, message: "User not found" });
					return;
				}
				var user = db_res.getRes().rows[0];

				if (!user || user.authKey != userApi.getUserKey(user.email, req.body.oldPassowrd)) {
					res.json({ errCode: 104, message: "Wrong user or wrong old password" });
					return;
				}

				userApi.setPassword(user.user_id, user.email, req.body.newPassword, function (err_, tpl_) {
					if (err_) {
						res.json({ errCode: 106, message: "Fail to set new password" });
					} else {
						var res_ = tpl_.getRes();
						if (res_.meta.err) {
							res.json({ errCode: 106, message: "Fail to set new password" });
						} else {
							res.json({ errCode: 0, message: "password was changed" });
						}
					}
				});
			});
		} else {
			res.json({ err: "email is missing" });
		}
	});

	router.post('/forgotPassword', function (req, res, next) {
		console.log('forgotPassword');
		console.log(req.body);

		if (req.body.email) {
			userApi.findByEmail(req.body.email, function (db_res) {
				var res_ = db_res.getRes();
				if (res_.meta.err || !res_.rows || res_.rows.length === 0) {
					res.json({ valid: true, err: res_.meta.err || "User not found" })
				} else {
					res.json({ valid: false, err: "emailSent" });
				}
			})
		} else {
			res.json({ err: "email is missing" });
		}
	});

	router.get('/chkVlu', function (req, res, next) {
		if (req.query.email) {
			userApi.findByEmail(req.query.email, function (db_res) {
				var res_ = db_res.getRes();
				if (res_.meta.err || !res_.rows || res_.rows.length === 0) {
					res.json({ valid: true, err: res_.meta.err || null })
				} else {
					res.json({ valid: false, err: "userExist" });
				}
			})
		} else if (req.query.phone) {
			//to do check phone
			if (req.query.phone.length > 3) {
				res.json({ valid: true, err: null })
			} else {
				res.json({ valid: false, err: "phoneExist" });
			}
		} else {
			res.json({ "err": "strange request" });
		}
	});

	return router;
};

export { userApi };
