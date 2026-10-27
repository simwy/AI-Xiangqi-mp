'use strict'
module.exports = function getConfig() {
	if (process.env.UNICLOUD_GATEWAY_SECRET) return { gatewaySecret: process.env.UNICLOUD_GATEWAY_SECRET }
	return require('./config.json')
}
