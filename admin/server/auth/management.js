import express from 'express';
import adminRole from './roles/admin.js';

const roles = {
	'admin': adminRole()
};

const main = express.Router();

const manage = function (req, res) {
	try {
		var user = req.user;
		console.log(user)
		if (user && user.role && roles[user.role]) {
			console.log('manage - calling user by role:' + user.role)
			console.log(req.originalUrl)
			return roles[user.role](req, res);
		}

		console.log("404 : " + JSON.stringify(user))
		res.status(404).end();
	} catch (e) {
		console.log(`\x1b[31mmanagment.js - manage exception: ${e}\x1b[0m`)
		res.status(500).end();
	}
};

main.get('*', manage);
main.post('*', manage);
main.put('*', manage);
main.delete('*', manage);

export default main;
