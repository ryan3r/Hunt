var express = require("express");
var exphbs = require("express-handlebars");
var qr = require("qr-image");
var bodyParser = require("body-parser");
var handlebars = require("handlebars");
var fs = require("fs");
var path = require("path");

const HOSTNAME = process.env.HOSTNAME || "http://localhost:9090";
const MINUTE_IN_MS = 60000;
const DAY_IN_MINUTES = 1440;
const HOUR_IN_MINUTES = 60;

var data = require("/mnt/data");

// save the data
var save = function() {
	fs.writeFileSync("/mnt/data.json", JSON.stringify(data, null, 4));

	debounceSave = true;
};

var debounceSave, debounceTimer;

// reload data when it changes
fs.watch("/mnt/data.json", function() {
	// watch can send multiple changes when writing make sure we are done
	clearTimeout(debounceTimer);
	debounceTimer = setTimeout(function() {
		// make sure we did not make the change
		if(debounceSave) {
			debounceSave = false;
			return;
		}

		// reload
		data = JSON.parse(fs.readFileSync(path.join(__dirname, "/mnt/data.json")));
	}, 3000);
});

var app = express();

// parse form responses
app.use(bodyParser.urlencoded({ extended: false }));

// configure handlebars
var hbs = exphbs.create({
	defaultLayout: "main",
	helpers: {
		// a helper to create a qr code
		qr: function(url) {
			// get the base64 encoded bar code
			var imgStr = qr.imageSync(url).toString("base64");

			return new handlebars.SafeString(`<img src="data:image/png;base64,${imgStr}"/>`);
		}
	}
});

// set up the templating engine
app.engine("handlebars", hbs.engine);
app.set("view engine", "handlebars");

// configure static routes
app.use("/static", express.static(__dirname + "/static"));

// get the home page
app.get("/", function(req, res) {
	res.render("hunter", {
		total: data.clues.length,
		time: prettyTime((data.end || Date.now()) - data.start),
		hintCount: data.hints,
		clues: data.clues
			// only show clues that have been solved
			.filter(clue => clue.solved || clue.unlocked)
			// show the most recent clues at the top
			.sort((a, b) => {
				if(a.unlocked && !b.unlocked) return -1;
				if(!a.unlocked && b.unlocked) return 1;

				return b.solved - a.solved
			})
	});
});

// update the number of hints available
app.get("/hints", function(req, res) {
	if(!isNaN(+req.query.hints)) {
		data.hints = +req.query.hints;

		save();
	}

	res.end("DONE");
});

// start the hunt
app.get("/start", function(req, res) {
	let clue = data.clues[0];

	if(!data.start) {
		// set the start time
		data.start = Date.now();
		// unlock the first clue
		clue.unlocked = true;

		save();
	}

	return res.redirect("/clue/" + data.clues[0].id)
});

// get the clue print out
app.get("/print", function(req, res) {
	// check if we have any filters
	var filtered = Object.getOwnPropertyNames(req.query).length > 0;

	res.render("print", {
		clues: data.clues.map(clue => {
			// don't mutate the original clue
			var proto = Object.create(clue);

			// add the url for when a clue is solved
			proto.solveUrl = HOSTNAME + "/solve?id=" + clue.solveCode;

			// mark the code as shown
			proto.show = !filtered || req.query[clue.id] == "on";

			return proto;
		})
	});
});

// view a clue
app.get("/clue/:id", function(req, res) {
	let clue = data.clues.find(c => c.id == req.params.id);

	// get the item
	if(clue) {
		res.render("clue", {
			clue: clue,
			content: fs.readFileSync(path.join("/mnt/clues", clue.id, "content.html")),
			hint: fs.readFileSync(path.join("/mnt/clues", clue.id, "hint.html")),
			showHint: clue.hintShown || clue.solved,
			hintCount: data.hints,
			access: clue.unlocked || clue.solved
		});
	}
	// clue not found
	else {
		res.render("clue", {
			access: false
		});
	}
});

// unlock a hint
app.post("/clue/:id", function(req, res) {
	let clue = data.clues.find(c => c.id == req.params.id);

	// clue not found
	if(!clue) {
		res.status(404).end("The clue you where looking for could not be found");
		return;
	}

	// show the hint if we need to
	if(!clue.hintShown || clue.solved) {
		if(data.hints > 0) {
			clue.hintShown = true;
			--data.hints;
		}
	}

	save();

	// send the clue page
	res.render("clue", {
		clue: clue,
		content: fs.readFileSync(path.join(__dirname, "clues", clue.id, "content.html")),
		hint: fs.readFileSync(path.join(__dirname, "clues", clue.id, "hint.html")),
		showHint: clue.hintShown || clue.solved,
		hintCount: data.hints,
		access: clue.unlocked || clue.solved
	});
});

// solve a clue
app.get("/solve", function(req, res) {
	// start the time
	if(!data.start) {
		data.start = Date.now();
	}

	// search for the clue that has been solved
	for(let clue of data.clues) {
		if(clue.solveCode == req.query.id) {
			clue.unlocked = false;

			let next = data.clues.find(clue => clue.unlocked);

			// this clue has not been solved
			if(!clue.solved) {
				// mark the clue as solved
				clue.solved = Date.now();
			}

			// find another clue to solve
			if(!next) {
				next = data.clues.find(clue => !clue.solved);
			}

			// unlock the next clue
			if(next) {
				next.unlocked = true;
			}

			save();

			// go to the clue
			res.render("solved", {
				solved: true,
				done: !next,
				next,
				name: clue.name
			});

			return;
		}
	}

	// not a clue
	res.render("solved", {
		solved: false,
		code: req.query.id
	});
});

// start the server
app.listen(9090, () => console.log("Server started"));

// print the play time in a human readable format
function prettyTime(ms) {
	// only padd the hours if there is another time value
	var padHours = false;

	// convert milliseconds to minutes
	var mins = (ms / MINUTE_IN_MS | 0);
	var timeStr = "";

	// add days
	if(DAY_IN_MINUTES <= mins) {
		timeStr += (mins / DAY_IN_MINUTES | 0) + ":";
		// remove days
		mins %= DAY_IN_MINUTES;

		padHours = true;
	}

	// add hours
	if(HOUR_IN_MINUTES <= mins) {
		let hrs = mins / HOUR_IN_MINUTES | 0;

		timeStr += padHours ? zeroPad(hrs) : hrs;
		// remove hours
		mins %= HOUR_IN_MINUTES;
	}
	else {
		timeStr += "0";
	}

	timeStr += ":";

	// add minutes
	timeStr += zeroPad(mins);

	return timeStr;
}

// pad a number with 0s
var zeroPad = num => num < 10 ? "0" + num : num;
