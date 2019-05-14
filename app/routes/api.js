module.exports = function(app) {
     var Web3 = require('web3')
     var Tx = require('ethereumjs-tx')
	var stripHexPrefix = require('strip-hex-prefix')
     var ethereum_address = require('ethereum-address')
     const mongo = require('mongodb').MongoClient
     const url = 'mongodb://localhost:27017'
     const schedule = require('node-schedule')

     var bnGlobal = 0
     var nonceGlobal = 0

     /* Web3 Initialization */
     const { WebsocketProvider } = Web3.providers
     const provider = new WebsocketProvider(app.web3.provider)
     
     var web3 = new Web3(provider); // Using Infura

     /* Contract initialization */
     var newContractObj = new web3.eth.Contract(app.contract.new.abi, app.contract.new.address)
     newContractObj.options.from = app.contract.new.owner_address
     
     var oldContractObj = new web3.eth.Contract(app.contract.old.abi, app.contract.old.address)
     oldContractObj.options.from = app.contract.old.owner_address

     /* Calculate Token Amount */
     function calculateTokenAmount(tokens) {
          const rate = 1.4285
          let tokenAmount = tokens.toString()
          let lengthA = tokenAmount.length

          tokenAmount = tokenAmount.replace(new RegExp('0', 'g'), '')
          let lengthB = tokenAmount.length

          let tokenInteger = parseInt(tokenAmount)
          let zeroCount = lengthA - lengthB
          
          let tokenFloat = parseFloat((parseFloat(tokenInteger * rate)).toFixed(5))
          let tokenString = tokenFloat.toString()
          let dotIndex = tokenString.indexOf('.')

          let finalZeroCount = zeroCount
          if(dotIndex !== -1) {
               let exclude = tokenString.length - 1 - dotIndex
               finalZeroCount -= exclude
          }

          let finalToken = tokenString.replace('.', '')
          if(finalZeroCount > 0){
               for(let i = 0; i < finalZeroCount; i++)
                    finalToken += '0'
          }

          return finalToken
     }

     /* Send New Tokens */
     async function sendNewTokens(collection, address, tokenAmount, hash) {
          var privateKeyString = stripHexPrefix(app.dist.privateKey)
          var privateKey = Buffer.from(privateKeyString, 'hex')
          var gasPrice = await web3.eth.getGasPrice() 

          var nonce = await web3.eth.getTransactionCount(app.dist.address)
          if(nonceGlobal != 0 && nonceGlobal >= nonce)
               nonce = nonceGlobal + 1

          nonceGlobal = nonce

          var txData = newContractObj.methods.transfer(address, tokenAmount).encodeABI();
          var txParams = {
               nonce: web3.utils.toHex(nonce),
               gasPrice: web3.utils.toHex(gasPrice),
               gasLimit: web3.utils.toHex(400000),
               from: app.dist.address,
               to: app.contract.new.address,
               value: '0x00',
               chainId: app.chainId,
               data: txData
          }

          var tx = new Tx(txParams)
          tx.sign(privateKey)

          var serializedTx = tx.serialize()

          web3.eth.sendSignedTransaction('0x' + serializedTx.toString('hex'))
          .on('transactionHash', function(t_hash){
               collection.updateOne({hash}, {'$set': {status: 'executed', t_hash}}, () => {})
          }).on('error', function(err){
               collection.updateOne({hash}, {'$set': {status: 'failed'}}, () => {})
          }).on('receipt', function(res){
          })
     }

     /* Check Executed Ones */
     function checkItem(collection, item) {
          collection.updateOne({_id: item._id}, {'$set': {status: 'final_checking'}}, () => {})

          const {t_hash} = item

          if(t_hash) {
               web3.eth.getTransactionReceipt(t_hash, function(error, res) {
                    if(res && res.hasOwnProperty('status')) {
                         if(res.status == true) {
                              collection.updateOne({_id: item._id}, {'$set': {status: 'finished'}}, () => {})
                         } else {
                              collection.updateOne({_id: item._id}, {'$set': {status: 'failed'}}, () => {})
                         }
                    } else {
                         collection.updateOne({_id: item._id}, {'$set': {status: 'executed'}}, () => {})
                    }
               })
          } else {
               collection.updateOne({_id: item._id}, {'$set': {status: 'failed'}}, () => {})
          }
     }

     /* Process Queue */
     function processItem(collection, blacklistCollection, item) {
          collection.updateOne({_id: item._id}, {'$set': {status: 'processing'}}, () => {})
          
          const {address, tokenAmount, hash} = item

          if(address && tokenAmount && hash) {
               web3.eth.getTransactionReceipt(hash, function(error, res) {
                    if(res && res.hasOwnProperty('status')) {
                         if(res.status == true) {
                              /* Check Blacklisted address here */
                              blacklistCollection.findOne({address}, (err, bitem) => {
                                   if(!bitem) {
                                        sendNewTokens(collection, address, tokenAmount, hash)
                                   } else {
                                        collection.updateOne({_id: item._id}, {'$set': {status: 'blacklisted'}}, () => {})
                                   }
                              })
                         } else {
                              collection.updateOne({_id: item._id}, {'$set': {status: 'failed'}}, () => {})
                         }
                    } else {
                         collection.updateOne({_id: item._id}, {'$set': {status: 'pending'}}, () => {})
                    }
               })
          } else {
               collection.updateOne({_id: item._id}, {'$set': {status: 'failed'}}, () => {})
          }
     }

     /* Get BlockNumber */
     function getBlockNumber(bnCollection) {
          return new Promise(function(resolve, reject) {
               bnCollection.findOne({key: "bn"}, (err, item) => {
                    if(err){
                         reject()
                    } else {
                         if(item){
                              if(bnGlobal > parseInt(item.value)) {
                                   resolve({bn: bnGlobal, exist: true})
                              } else {
                                   resolve({bn: item.value, exist: true})
                              }
                         } else {
                              resolve({bn: bnGlobal, exist: false})
                         }
                    }
               })
          })
     }

     /* Add to blacklist */
     function addBlacklist(collection, address) {
          return new Promise(function(resolve, reject) {
               collection.findOne({address}, (err, item) => {
                    if(err)
                         reject()

                    if(!item) {
                         collection.insertOne({address}, () => {
                              resolve()
                         })
                    } else {
                         resolve()
                    }
               })
          })
     }

     /* API Part Begin */
     app.get('/blacklist', function(req, res){
          let address = ''

          if(req && req.query && req.query.address) {
               address= req.query.address.trim().toLowerCase()
          }

          if(address == '') {
               return res.send({status: false, message: 'empty address'})
          }

          mongo.connect(url, {useNewUrlParser: true}, (err, client) => {
               if(err || !client)
                    return res.send({status: false, message: 'db error'})

               const db = client.db('sim_swap')
               const collection = db.collection('blacklist')
               
               addBlacklist(collection, address).then(function(){
                    collection.find({}).toArray(function(err, items) {
                         return res.send({status: true, items})
                    })
               }).catch(function(){
                    return res.send({status: false, message: 'adding error'})
               })
          })
     })
     /* API Part End */

     mongo.connect(url, {useNewUrlParser: true}, (err, client) => {
          if (err) {
            return
          }

          const db = client.db('sim_swap')
          const collection = db.collection('tx')
          const bnCollection = db.collection('setting')
          const blacklistCollection = db.collection('blacklist')

          getBlockNumber(bnCollection).then(function(bnRes){
               bnGlobal = parseInt(bnRes.bn)
               let exist = bnRes.exist
               
               let bn = bnGlobal

               /* App Start */
               oldContractObj.events.Transfer({
                    fromBlock: bn,
                    filter: {to: app.monitor.address}
               })
               .on('data', (log) => {
                    let { returnValues: { from, to, tokens }, blockNumber, transactionHash } = log
                    
                    blockNumber = parseInt(blockNumber)
                    from = from.trim().toLowerCase()
                    to = to.trim().toLowerCase()
                    
                    if(blockNumber > bnGlobal && to == app.monitor.address.toLowerCase() && transactionHash){
                         console.log('incoming block #', blockNumber)
                         
                         bnGlobal = blockNumber

                         let address = from
                         let tokenAmount = calculateTokenAmount(tokens)
                         let hash = transactionHash

                         collection.findOne({hash}, (err, item) => {
                              if(!item) {
                                   collection.insertOne({address, tokenAmount, hash, blockNumber, status: 'pending'}, () => {})
                              }

                              if(exist) {
                                   bnCollection.updateOne({key: 'bn'}, {'$set': {value: bnGlobal}}, () => {})
                              } else {
                                   exist = true
                                   bnCollection.insertOne({key: 'bn', value: bnGlobal}, () => {})
                              }
                         })
                    }
               })
               .on('changed', (log) => {})
               .on('error', (log) => {})
               /* App End */
          })

          /* Schedule */
          var monitor = schedule.scheduleJob('* * * * *', function(){
               console.log('running monitor')

               collection.find({status: 'pending'}).limit(3).toArray(function(err, items) {
                    if(items) {
                         for(let i in items) {
                              let item = items[i]

                              processItem(collection, blacklistCollection, item)
                         }
                    }
               })
          })

          var executed = schedule.scheduleJob('* * * * *', function(){
               console.log('running execution')

               collection.find({status: 'executed'}).limit(5).toArray(function(err, items) {
                    if(items) {
                         for(let i in items) {
                              let item = items[i]

                              checkItem(collection, item)
                         }
                    }
               })
          })
          /* Schedule End */
     })
}