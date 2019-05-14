var bodyParser = require('body-parser')
var express = require('express')

var app = express()

// Config
var config = require("./config/live.js")

// Web3 configuration
app.web3 = config.web3

// Contract configuration
app.contract = {
     new: {},
     old: {}
}

app.contract.new.abi = require("./app/resources/" + config.contract.new.abi)
app.contract.new.address = config.contract.new.address
app.contract.new.owner_address = config.contract.new.owner_address
app.contract.new.password = config.contract.new.password
app.contract.new.decimals = config.contract.new.decimals

app.contract.old.abi = require("./app/resources/" + config.contract.old.abi)
app.contract.old.address = config.contract.old.address
app.contract.old.owner_address = config.contract.old.owner_address
app.contract.old.password = config.contract.old.password
app.contract.old.decimals = config.contract.old.decimals

// Wallet configuration
app.monitor = config.monitor
app.dist = config.dist

// Chain ID configuration
app.chainId = config.chainId

// App key
app.key = config.key

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
	extended: true
}))

require('./app/routes/api')(app)

app.listen(3001, function(){
     console.log(`Listening at http://localhost:3001`)
})