import { executeSql } from "../sources/dbpool.js";

import express from 'express';
import _ from 'lodash';
import { Router as r404 } from "./r404.js";

class dashboard{

	getDashboard(prms_, cb_){
		var q_="SELECT cmpgn,  DATE_FORMAT(dt,'%Y-%m-%d') AS dt,DATE_FORMAT(dt,'WK-%y%U') AS wk,DATE_FORMAT(dt,'%a' ) AS dow,  imps, leads,closed_leads ,\r\n"+
   				"  rev,  cost, pipe FROM ws.dashboard WHERE dt BETWEEN :from AND :to ";

		executeSql(q_, prms_, function(db_res){
			try{
				cb_(db_res.getRes());
			}catch(e){
				console.log("getDashboard EXCEPTION "+e)
			}
		})
	}
}

export const Router=function(){
	var dshb_=new dashboard();
	
	var dashboardRouter = express.Router();

	dashboardRouter.get('/avg/:from/:to',function(req,res){
		console.log("getDashboard "+JSON.stringify(req.params));
		dshb_.getAvg(req.params, (tpl_)=>{
			//console.log("getDashboard got res :\r\n"+JSON.stringify(tpl_, null, '\t'));
			res.json(tpl_)
		})
	});	
	dashboardRouter.get('/:from/:to/:brkdwn',function(req,res){
		console.log("getDashboard "+JSON.stringify(req.params));
		dshb_.getDashboard(req.params, (tpl_)=>{
			//console.log("getDashboard got res :\r\n"+JSON.stringify(tpl_, null, '\t'));
			res.json(tpl_)
		})
	});

	dashboardRouter.use("/*", r404())
	
	return dashboardRouter;
};
