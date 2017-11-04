var Service;
var Characteristic;
var RxTypes, RxInputs;
var request = require("request");
var pollingtoevent = require('polling-to-event');
var util = require('util');
var round = require( 'math-round' );

module.exports = function(homebridge)
{
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  RxTypes = require('./RxTypes.js')(homebridge);
  homebridge.registerAccessory("homebridge-onkyo", "Onkyo", HttpStatusAccessory);
}

function HttpStatusAccessory(log, config) 
{
	this.log = log;
	var that = this;
	this.eiscp = require('eiscp');
	this.setAttempt = 0;

	this.name = config["name"];
	this.ip_address	= config["ip_address"];
	this.model = config["model"];
	
	this.poll_status_interval = config["poll_status_interval"] || "0";
	this.defaultInput = config["default_input"]; 
	this.defaultVolume = config['default_volume'];
	this.maxVolume = config['max_volume'] || 30;
	this.mapVolume100 = config['map_volume_100'] || false;
	
	this.state = false;
	this.m_state = false;
	this.v_state = 0;
	this.i_state = 1;
	this.interval = parseInt( this.poll_status_interval);
	this.avrManufacturer = "Onkyo";
	this.avrSerial = "unknown";

//	this.eiscp.discover(function(err,result){	
//		if(err) {
//			that.log("Onkyo - ERROR - No RX found. Result: %s", result);
//        } else {
//			that.log("Onkyo - Found these receivers on the local network. Connecting to first...");
//			that.log(result);
//			that.avrSerial = result[0].mac;
//        }
//	});

	this.switchHandling = "check";
	if (this.interval > 10 && this.interval < 100000) {
		this.switchHandling = "poll";
	}
	
	this.eiscp.on('debug', this.eventDebug.bind(this));
	this.eiscp.on('error', this.eventError.bind(this));
	this.eiscp.on('connect', this.eventConnect.bind(this));
	this.eiscp.on('system-power', this.eventSystemPower.bind(this));
	this.eiscp.on('master-volume', this.eventVolume.bind(this));
	this.eiscp.on('close', this.eventClose.bind(this));
	this.eiscp.on('audio-muting', this.eventAudioMuting.bind(this));
	this.eiscp.on('input-selector', this.eventInput.bind(this));
	
	this.eiscp.connect(
		{host: this.ip_address, reconnect: true, model: this.model}
	);

// Create the RxInput object for later use.
	var eiscpData = require('./node_modules/eiscp/eiscp-commands.json');
	eiscpData = eiscpData.commands.main.SLI.values;
	var newobj = '{ "Inputs" : [';
	for (var exkey in eiscpData) {
			var hold = eiscpData[exkey].name.toString();
			if (hold.includes(',')) {
					hold = hold.substring(0,hold.indexOf(','));
			}
			if (exkey.includes('�') || exkey.includes('�')) {
					exkey = exkey.replace(/\�/g, "");
					exkey = exkey.replace(/\�/g, "");
			}
			newobj = newobj + '{ "code":"'+exkey+'" , "label":"'+hold+'" },';
	}
			newobj = newobj + '{ "code":"2B" , "label":"network" } ]}';
	RxInputs = JSON.parse(newobj);

// Status Polling
	if (this.switchHandling == "poll") {
		var powerurl = this.status_url;
		that.log("start long poller..");
// PWR Polling	
		var statusemitter = pollingtoevent(function(done) {
			that.log("start PWR polling..");
			that.getPowerState( function( error, response) {
				//pass also the setAttempt, to force a homekit update if needed
				done(error, response, that.setAttempt);
			}, "statuspoll");
		}, {longpolling:true,interval:that.interval * 1000,longpollEventName:"statuspoll"});

		statusemitter.on("statuspoll", function(data) {
			that.state = data;
			that.log("event - PWR status poller - new state: ", that.state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.On).setValue(that.state, null, "statuspoll");
			}
		});
// Audio-Input Pollling		
		var i_statusemitter = pollingtoevent(function(done) {
			that.log("start INPUT polling..");
			that.getInputSource( function( error, response) {
				//pass also the setAttempt, to force a homekit update if needed
				done(error, response, that.setAttempt);
			}, "i_statuspoll");
		}, {longpolling:true,interval:that.interval * 1000,longpollEventName:"i_statuspoll"});

		i_statusemitter.on("i_statuspoll", function(data) {
			that.i_state = data;
			that.log("event - INPUT status poller - new i_state: ", that.i_state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(RxTypes.InputSource).setValue(that.i_state, null, "i_statuspoll");
			}
		});	
// Audio-Muting Pollling		
		var m_statusemitter = pollingtoevent(function(done) {
			that.log("start MUTE polling..");
			that.getMuteState( function( error, response) {
				//pass also the setAttempt, to force a homekit update if needed
				done(error, response, that.setAttempt);
			}, "m_statuspoll");
		}, {longpolling:true,interval:that.interval * 1000,longpollEventName:"m_statuspoll"});

		m_statusemitter.on("m_statuspoll", function(data) {
			that.m_state = data;
			that.log("event - MUTE status poller - new m_state: ", that.m_state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.Mute).setValue(that.m_state, null, "m_statuspoll");
			}
		});	
// Volume Pollling		
		var v_statusemitter = pollingtoevent(function(done) {
			that.log("start VOLUME polling..");
			that.getVolumeState( function( error, response) {
				//pass also the setAttempt, to force a homekit update if needed
				done(error, response, that.setAttempt);
			}, "v_statuspoll");
		}, {longpolling:true,interval:that.interval * 1000,longpollEventName:"v_statuspoll"});

		v_statusemitter.on("v_statuspoll", function(data) {
			that.v_state = data;
			that.log("event - VOLUME status poller - new v_state: ", that.v_state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.Volume).setValue(that.v_state, null, "v_statuspoll");
			}
		});		
	}
}

HttpStatusAccessory.prototype = {

eventDebug: function( response)
{
	//this.log( "eventDebug: %s", response);
},

eventError: function( response)
{
	this.log( "eventError: %s", response);
},

eventConnect: function( response)
{
	this.log( "eventConnect: %s", response);
},

eventSystemPower: function( response)
{
	//this.log( "eventSystemPower: %s", response);
	this.state = (response == "on");
	this.log("eventSystemPower - message: %s, new state %s", response, this.state);
	//Communicate status
	if (this.switchService ) {
		this.switchService.getCharacteristic(Characteristic.On).setValue(this.state, null, "statuspoll");
	}		
},

eventAudioMuting: function( response)
{
	this.m_state = (response == "on");
	this.log("eventAudioMuting - message: %s, new m_state %s", response, this.m_state);
	//Communicate status
	if (this.switchService ) {
		this.switchService.getCharacteristic(Characteristic.Mute).setValue(this.m_state, null, "m_statuspoll");
	}	
},

eventInput: function( response)
{
	if (response) { 
		var input = JSON.stringify(response);
		input = input.replace(/[\[\]"]+/g,'');
		if (input.includes(',')) {
			input = input.substring(0,input.indexOf(','));
		}
		// Convert to number for input slider and i_state
		for (var a in RxInputs.Inputs) {
			if (RxInputs.Inputs[a].label == input) {
				this.i_state = a;
				break;
			}
		}
		this.log("eventInput - message: %s - new i_state: %s - input: %s", response, this.i_state, input);
		
		//Communicate status
		if (this.switchService ) {
			this.switchService.setCharacteristic(RxTypes.InputLabel,input);
			this.switchService.getCharacteristic(RxTypes.InputSource).setValue(this.i_state, null, "i_statuspoll");
		}	
	} else {
		// Then invalid Input chosen
		this.log("eventInput - ERROR - INVALID INPUT - Model does not support selected input.");
		
		//Update input label status
		if (this.switchService ) {
			this.switchService.setCharacteristic(RxTypes.InputLabel,"INVALID");
		}			
	}
},

eventVolume: function( response)
{
	if (this.mapVolume100) {
        var volumeMultiplier = this.maxVolume/100;
        var newVolume = response / volumeMultiplier;
		this.v_state = round(newVolume); 
		this.log("eventVolume - message: %s, new v_state %s PERCENT", response, this.v_state);
	} else {		
		this.v_state = response; 
		this.log("eventVolume - message: %s, new v_state %s ACTUAL", response, this.v_state);
	}
	//Communicate status
	if (this.switchService ) {
		this.switchService.getCharacteristic(Characteristic.Volume).setValue(this.v_state, null, "v_statuspoll");
	}
},

eventClose: function( response)
{
	this.log( "eventClose: %s", response);
},

setPowerState: function(powerOn, callback, context) {
	var that = this;
//if context is statuspoll, then we need to ensure that we do not set the actual value
	if (context && context == "statuspoll") {
		this.log( "setPowerState - polling mode, ignore, state: %s", this.state);
		callback(null, this.state);
	    return;
	}
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }

	this.setAttempt = this.setAttempt+1;
		
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	that.state = powerOn;
	callback( null, that.state);
    if (powerOn) {
		this.log("setPowerState - actual mode, power state: %s, switching to ON", that.state);
		this.eiscp.command("system-power=on", function(error, response) {
			//that.log( "PWR ON: %s - %s -- current state: %s", error, response, that.state);
			if (error) {
				that.state = false;
				that.log( "setPowerState - PWR ON: ERROR - current state: %s", that.state);
				if (that.switchService ) {
					that.switchService.getCharacteristic(Characteristic.On).setValue(powerOn, null, "statuspoll");
				}					
			} else {
				// If the AVR has just been turned on, apply the default volume
					this.log("Attempting to set the default volume to "+this.defaultVolume);
					if (powerOn && this.defaultVolume) {
						that.log("Setting default volume to "+this.defaultVolume);
						this.eiscp.command("master-volume:"+this.defaultVolume, function(error, response) {
							if (error) {
								that.log( "Error while setting default volume: %s", error);
							}
						});
					}
				// If the AVR has just been turned on, apply the Input default 
					this.log("Attempting to set the default input selector to "+this.defaultInput);
					if (powerOn && this.defaultInput) {
						that.log("Setting default input selector to "+this.defaultInput);
						this.eiscp.command("input-selector="+this.defaultInput, function(error, response) {
							if (error) {
								that.log( "Error while setting default input: %s", error);
							}
						});			
					}
			}
		}.bind(this) );
	} else {
		this.log("setPowerState - actual mode, power state: %s, switching to OFF", that.state);
		this.eiscp.command("system-power=standby", function(error, response) {
			//that.log( "PWR OFF: %s - %s -- current state: %s", error, response, that.state);
			if (error) {
				that.state = false;
				that.log( "setPowerState - PWR OFF: ERROR - current state: %s", that.state);
				if (that.switchService ) {
					that.switchService.getCharacteristic(Characteristic.On).setValue(that.state, null, "statuspoll");
				}					
			}
		}.bind(this) );		
    }
},
  
getPowerState: function(callback, context) {
	var that = this;
	//if context is statuspoll, then we need to request the actual value
	if (!context || context != "statuspoll") {
		if (this.switchHandling == "poll") {
			this.log("getPowerState - polling mode, return state: ", this.state);
			callback(null, this.state);
			return;
		}
	}
	
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }
	
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	callback(null, this.state);
    this.log("getPowerState - actual mode, return state: ", this.state);
	this.eiscp.command("system-power=query", function( error, data) {
		if (error) {
			that.state = false;
			that.log( "getPowerState - PWR QRY: ERROR - current state: %s", that.state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.On).setValue(that.state, null, "statuspoll");
			}					
		}	
	}.bind(this) );
},

getVolumeState: function(callback, context) {
	var that = this;
	//if context is v_statuspoll, then we need to request the actual value
	if (!context || context != "v_statuspoll") {
		if (this.switchHandling == "poll") {
			this.log("getVolumeState - polling mode, return v_state: ", this.v_state);
			callback(null, this.v_state);
			return;
		}
	}
	
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }
	
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	callback(null, this.v_state);
    this.log("getVolumeState - actual mode, return v_state: ", this.v_state);
	this.eiscp.command("master-volume=query", function( error, data) {
		if (error) {
			that.v_state = 0;
			that.log( "getVolumeState - VOLUME QRY: ERROR - current v_state: %s", that.v_state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.Volume).setValue(that.v_state, null, "v_statuspoll");
			}					
		}	
	}.bind(this) );
},

setVolumeState: function(volumeLvl, callback, context) {
	var that = this;
//if context is v_statuspoll, then we need to ensure that we do not set the actual value
	if (context && context == "v_statuspoll") {
		this.log( "setVolumeState - polling mode, ignore, v_state: %s", this.v_state);
		callback(null, this.v_state);
	    return;
	}
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }

	this.setAttempt = this.setAttempt+1;
	
	//Are we mapping volume to 100%?
	if (this.mapVolume100) {
        var volumeMultiplier = this.maxVolume/100;
        var newVolume = volumeMultiplier * volumeLvl;		
		this.v_state = round(newVolume); 
		this.log("setVolumeState - actual mode, PERCENT, volume v_state: %s", that.v_state);
	} else if (volumeLvl > this.maxVolume) {		
	//Determin if maxVolume threshold breached, if so set to max.
		that.v_state = this.maxVolume;
		this.log("setVolumeState - VOLUME LEVEL of: %s exceeds maxVolume: %s. Resetting to max.", volumeLvl, this.maxVolume);
	} else {
	// Must be using actual volume number
		that.v_state = volumeLvl;
		this.log("setVolumeState - actual mode, ACTUAL volume v_state: %s", that.v_state);
	}
	
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	callback( null, that.v_state);

	this.eiscp.command("master-volume:" + that.v_state, function(error, response) {
		if (error) {
			that.v_state = 0;
			that.log( "setVolumeState - VOLUME : ERROR - current v_state: %s", that.v_state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.Volume).setValue(that.v_state, null, "v_statuspoll");
			}					
		}
	}.bind(this) );
},

getMuteState: function(callback, context) {
	var that = this;
	//if context is m_statuspoll, then we need to request the actual value
	if (!context || context != "m_statuspoll") {
		if (this.switchHandling == "poll") {
			this.log("getMuteState - polling mode, return m_state: ", this.m_state);
			callback(null, this.m_state);
			return;
		}
	}
	
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }
	
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	callback(null, this.m_state);
    this.log("getMuteState - actual mode, return m_state: ", this.m_state);
	this.eiscp.command("audio-muting=query", function( error, data) {
		if (error) {
			that.m_state = false;
			that.log( "getMuteState - MUTE QRY: ERROR - current m_state: %s", that.m_state);
			if (that.switchService ) {
				that.switchService.getCharacteristic(Characteristic.Mute).setValue(that.m_state, null, "m_statuspoll");
			}					
		}	
	}.bind(this) );
},

setMuteState: function(muteOn, callback, context) {
	var that = this;
//if context is m_statuspoll, then we need to ensure that we do not set the actual value
	if (context && context == "m_statuspoll") {
		this.log( "setMuteState - polling mode, ignore, m_state: %s", this.m_state);
		callback(null, this.m_state);
	    return;
	}
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }

	this.setAttempt = this.setAttempt+1;
		
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	that.m_state = muteOn;
	callback( null, that.m_state);
    if (that.m_state) {
		this.log("setMuteState - actual mode, mute m_state: %s, switching to ON", that.m_state);
		this.eiscp.command("audio-muting=on", function(error, response) {
			if (error) {
				that.m_state = false;
				that.log( "setMuteState - MUTE ON: ERROR - current m_state: %s", that.m_state);
				if (that.switchService ) {
					that.switchService.getCharacteristic(Characteristic.Mute).setValue(that.m_state, null, "m_statuspoll");
				}					
			}
		}.bind(this) );
	} else {
		this.log("setMuteState - actual mode, mute m_state: %s, switching to OFF", that.m_state);
		this.eiscp.command("audio-muting=off", function(error, response) {
			if (error) {
				that.m_state = false;
				that.log( "setMuteState - MUTE OFF: ERROR - current m_state: %s", that.m_state);
				if (that.switchService ) {
					that.switchService.getCharacteristic(Characteristic.Mute).setValue(that.m_state, null, "m_statuspoll");
				}					
			}			
		}.bind(this) );		
    }
},

getInputSource: function(callback, context) {
	var that = this;
	//if context is i_statuspoll, then we need to request the actual value
	if (!context || context != "i_statuspoll") {
		if (this.switchHandling == "poll") {
			this.log("getInputState - polling mode, return i_state: ", this.i_state);
			callback(null, this.i_state);
			return;
		}
	}
	
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }
	
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	callback(null, this.i_state);
    this.log("getInputState - actual mode, return i_state: ", this.i_state);
	this.eiscp.command("input-selector=query", function( error, data) {
		if (error) {
			that.i_state = 1;
			that.log( "getInputState - INPUT QRY: ERROR - current i_state: %s", that.i_state);
			if (that.switchService ) {
				that.switchService.setCharacteristic(RxTypes.InputLabel,"get error")
				that.switchService.getCharacteristic(RxTypes.InputSource).setValue(that.i_state, null, "i_statuspoll");
			}
		}			
	}.bind(this) );
},

setInputSource: function(source, callback, context) {
	var that = this;
//if context is i_statuspoll, then we need to ensure that we do not set the actual value
	if (context && context == "i_statuspoll") {
		this.log( "setInputState - polling mode, ignore, i_state: %s", this.i_state);
		callback(null, this.i_state);
	    return;
	}
    if (!this.ip_address) {
    	this.log.warn("Ignoring request; No ip_address defined.");
	    callback(new Error("No ip_address defined."));
	    return;
    }

	this.setAttempt = this.setAttempt+1;
	that.i_state = parseInt(source);
	this.log("setInputState - actual mode, ACTUAL input i_state: %s - label: %s", that.i_state, RxInputs.Inputs[that.i_state].label);
	
	//do the callback immediately, to free homekit
	//have the event later on execute changes
	callback(null, that.i_state);
	
	this.eiscp.command("input-selector:" + RxInputs.Inputs[that.i_state].label, function(error, response) {
		if (error) {
			that.log( "setInputState - INPUT : ERROR - current i_state:%s - Source:%s", that.i_state, source.toString());
			if (that.switchService ) {
				that.switchService.setCharacteristic(RxTypes.InputLabel,"set error")
				that.switchService.getCharacteristic(RxTypes.InputSource).setValue(that.i_state, null, "i_statuspoll");
			}
		}
	}.bind(this) );
},

identify: function(callback) {
    this.log("Identify requested!");
    callback(); // success
},

getServices: function() {
	var that = this;

	var informationService = new Service.AccessoryInformation();
    informationService
    .setCharacteristic(Characteristic.Manufacturer, this.avrManufacturer)
    .setCharacteristic(Characteristic.Model, this.model)
    .setCharacteristic(Characteristic.SerialNumber, this.avrSerial);

	this.switchService = new Service.Switch(this.name);

	this.switchService
		.getCharacteristic(Characteristic.On)
		.on('get', this.getPowerState.bind(this))
		.on('set', this.setPowerState.bind(this));

	this.switchService.addCharacteristic(Characteristic.Volume)
		.on('get', this.getVolumeState.bind(this))
		.on('set', this.setVolumeState.bind(this));	

	this.switchService.addCharacteristic(Characteristic.Mute)
		.on('get', this.getMuteState.bind(this))
		.on('set', this.setMuteState.bind(this));	

	this.switchService.addCharacteristic(RxTypes.InputSource)
		.on('get', this.getInputSource.bind(this))
		.on('set', this.setInputSource.bind(this));	

	this.switchService.addCharacteristic(RxTypes.InputLabel);			

	return [informationService, this.switchService];
}
};