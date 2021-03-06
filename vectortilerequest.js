/*
node-tileserver Copyright (C) 2014 Alexander Matheisen
This program comes with ABSOLUTELY NO WARRANTY.
This is free software, and you are welcome to redistribute it under certain conditions.
See https://github.com/rurseekatze/node-tileserver for details.
*/


// include necessary modules
var cluster = require('cluster');
var os = require('os');
var rbush = require('rbush');
var assert = require('assert');
var url = require("url");
var mkdirp = require('mkdirp');
var pg = require('pg');
var toobusy = require('toobusy-js');
var byline = require('byline');
var touch = require("touch");
var Canvas = require('canvas');
var events = require('events');
var log4js = require('log4js');
var fs = require('graceful-fs');


VectorTilerequest = function(self)
{
	this.tile = self.tile;
	this.response = self.response;
	this.command = self.command;
	this.queue = self.queue;
	this.requestModified = self.requestModified;
	this.params = self.params;
};

VectorTilerequest.prototype =
{
	// serves a vector tile
	getTile: function()
	{
		var self = this;
		self.tile.debug('Vector tile requested.');
		self.tile.readVectorData(function(err, data)
		{
			var jsonRequest;
			{
				var searchString = '.json';
				var subjectString = self.params[4];
				var position = subjectString.length;
				position -= searchString.length;
				var lastIndex = subjectString.indexOf(searchString, position);
				jsonRequest = lastIndex !== -1 && lastIndex === position;
			}

			if (err || self.command == "dirty")
			{
				if (err)
					self.tile.debug('Vectortile not cached, needs to be created...');
				if (self.command == "dirty")
					self.tile.debug('Vectortile dirty, needs to be refreshed...');

				self.tile.getVectorData(function(data)
				{
					self.tile.debug('Vector tile created successfully, saving vector tile...');

					self.tile.saveVectorData(function(err)
					{
						if (err)
						{
							self.abortRequest('Vector tile could not be saved.' + err);
							return;
						}

						self.tile.getModifyTime(function(err, mtime)
						{
							var header = self.getHeader(jsonRequest);

							if (!err)
							{
								header['Last-Modified'] = mtime.toUTCString();
								header['Cache-Control'] = 'public, max-age=3600';
							}

							self.tile.debug('Returning vector tile...');
							self.response.writeHead(200, header);
							if (!jsonRequest)
								self.response.end(self.tile.getDataString());
							else
								self.response.end(JSON.stringify(self.tile.data));
							self.tile.debug('Finished request.');
							return;
						});
					});
				}, function(err)
				{
					self.abortRequest('Vectortile could not be created. Aborting.' + err);
				});
			}
			else
			{
				// check if tile is expired and add it to the queue if necessary
				self.tile.isExpired(function(expired)
				{
					if (expired)
						self.queue.add(self.tile);

					self.tile.getModifyTime(function(err, mtime)
					{
						var header = self.getHeader(jsonRequest);

						if (!err)
							header['Last-Modified'] = mtime.toUTCString();

						if (expired)
							header['Cache-Control'] = 'max-age=0';
						else
							header['Cache-Control'] = 'public, max-age=3600';

						if (!err && self.requestModified.getTime() == mtime.getTime() && !expired)
						{
							self.response.writeHead(304, header);
							self.response.end();
							self.tile.debug('Finished request.');
							return;
						}
						else
						{
							self.tile.debug('Returning vector tile...');
							self.response.writeHead(200, header);
							if (!jsonRequest)
								self.response.end(self.tile.getDataString());
							else
								self.response.end(JSON.stringify(self.tile.data));
							self.tile.debug('Finished request.');
							return;
						}
					});
				});
			}
		});
	},

	// sends a 500 error response
	abortRequest: function(msg)
	{
		this.tile.warn(msg);
		this.response.writeHead(500, {'Content-Type': 'text/plain'});
		this.response.end();
		return;
	},

	getHeader: function(jsonRequest)
	{
		if (!jsonRequest)
			return {
				'Content-Type': 'text/javascript;charset=UTF-8',
				'Server': 'node-tileserver/0.3'
			};
		else
			return {
				'Content-Type': 'application/vnd.geo+json;charset=UTF-8',
				'Access-Control-Allow-Origin': '*',
				'Server': 'node-tileserver/0.3'
			};
	}
};

module.exports = VectorTilerequest;
