"use strict";

import express from 'express';

const unknown = function(req, res, next){
	console.log(' 404 request ')
	console.log(req.path);
	res.status(404);
	res.type('txt').send('Not found');
};

export const Router = function(){
	var router_404 = express.Router();

	router_404.get('/*',unknown);
	router_404.post('/*',unknown);

	return router_404;
};
