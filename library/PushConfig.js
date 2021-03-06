module.exports = function(vac, opts, log) {
  
  // we use the restify client.
  var restify = require('restify');
  var request = require('request');
  var async = require('async');

  // Connect two instances of astserisk by creating a trunk on each one to the other one.
  var connectInstances = function(instance_uuid_a,instance_uuid_b,context,callback) {

    // Alright, steps we need.
    // - Get info from discover all
    // - Associate items with instances
    // - Create trunk on A to B
    // - Create trunk on B to A

    // Some vars used across the series.
    var discovered;
    var info_a = null;
    var info_b = null;

    async.series({
      // Get info from discover all.
      discover: function(callback) {
        vac.discoverasterisk.discoverAll(function(err,discover_result){
          discovered = discover_result;
          callback(err);
        });
      },
      // Asociate discovered info with each instance.
      associate: function(callback) {

        if (discovered.length >= 2) {

          discovered.forEach(function(each_discovered){

            if (each_discovered.uuid == instance_uuid_a) {
              info_a = each_discovered;
            }

            if (each_discovered.uuid == instance_uuid_b) {
              info_b = each_discovered;
            }

          });

          if (info_a && info_b) {

            // alright, that looks like we have information for both instances.
            callback(false);

          } else {
            log.error("pushconfig_connect_error_nomatch",{ instance_uuid_a: instance_uuid_b, instance_uuid_b: instance_uuid_b, info_a: info_a, info_b, note: "no match for one or more instances"});
            callback("pushconfig_connect_error_nomatch");
          }

        } else {
          log.error("pushconfig_connect_error_notenoughinstances",{discovered: discovered, note: "there needs to be 2 or more instances to connect them"});
          callback("pushconfig_connect_error_notenoughinstances");
        }

      },
      // Create a trunk on instance A for instance B's info.
      create_trunk_a: function(callback) {

        // Give the trunk a cute name if you can.
        var trunkname = instance_uuid_b;
        if (info_b.nickname) {
          trunkname = info_b.nickname;
        }

        // Now go and create it.
        createEndPoint(instance_uuid_a,trunkname,info_b.ip,'32',context,function(err,result){
          callback(err,result);
        });

      },
      // Create a trunk on instance A for instance B's info.
      create_trunk_b: function(callback) {

        // Give the trunk a cute name if you can.
        var trunkname = instance_uuid_a;
        if (info_a.nickname) {
          trunkname = info_a.nickname;
        }

        // Now go and create it.
        createEndPoint(instance_uuid_b,trunkname,info_a.ip,'32',context,function(err,result){
          callback(err,result);
        });

      },
    },function(err,result){

      // And we're all finished.

      if (!err) {
        var returns = {create_trunk_a: result.create_trunk_a, create_trunk_b: result.create_trunk_b};
        log.it("pushconfig_connect_complete",returns);
        callback(false,returns);
      } else {
        log.error("pushconfig_connect_serieserror",{err: err});
        callback(err);
      }


    });

  }

  this.connectInstances = connectInstances;

  // Dynamically create an endpoint with pjsip.

  // More info @ https://wiki.asterisk.org/wiki/display/AST/ARI+Push+Configuration
  // And the blog: http://blogs.asterisk.org/2016/03/09/pushing-pjsip-configuration-with-ari/
  var createEndPoint = function(boxid,username,address,mask,context,callback) {

    vac.discoverasterisk.getBoxIP(boxid,function(err,asteriskip){

      if (!err) {
        
        listEndPoint(boxid,username,function(err,boxinfo){

          if (!err) {

            if (!boxinfo.exists) {

              var server_url = "http://asterisk:asterisk@" + asteriskip + ":" + opts.sourcery_port;
              // log.it("pushconfig_server_url",{server_url: server_url});

              var client = restify.createStringClient({
                version: '*',
                // connectTimeout: 500,
                // requestTimeout: 500,
                url: server_url,
              });

              var auth = {
                user: 'asterisk',
                pass: 'asterisk',
                sendImmediately: 'false',
              };

              // Scoped outside series
              var contact_address;

              async.series([
                // ------------------------- CREATE ENDPOINTS.
                // From the manual.
                /*
                $ curl -X PUT -H "Content-Type: application/json" -u asterisk:secret -d '{"fields": [ { "attribute": "from_user", "value": "alice" }, { "attribute": "allow", "value": "!all,g722,ulaw,alaw"}, {"attribute": "ice_support", "value": "yes"}, {"attribute": "force_rport", "value": "yes"}, {"attribute": "rewrite_contact", "value": "yes"}, {"attribute": "rtp_symmetric", "value": "yes"}, {"attribute": "context", "value": "default" }, {"attribute": "auth", "value": "alice" }, {"attribute": "aors", "value": "alice"} ] }' https://localhost:8088/ari/asterisk/config/dynamic/res_pjsip/endpoint/alice
                */
                function(callback){

                  var url = server_url + "/ari/asterisk/config/dynamic/res_pjsip/endpoint/" + username;

                  var formData = {
                    fields: [
                      { attribute: 'transport', value: 'transport-udp' },
                      { attribute: 'context', value: context },
                      { attribute: 'aors', value: username },
                      { attribute: 'disallow', value: 'all' },
                      { attribute: 'allow', value: 'ulaw' },
                    ]
                  }

                  // client.put(url, fields, function(err, req, res, data) {
                  request.put({url: url, json: formData}, function (err, res, data) {
                    
                    // console.log('%d -> %j', res.statusCode, res.headers);
                    // console.log('%s', data);

                    if (!err && res.statusCode == 200) {
                      // Ok, do things.
                      callback(false);
                    } else {
                      if (!err) {
                        err = "pushconfig_endpoint_statuscode_error_" + res.statusCode;
                      }
                      log.error("pushconfig_error_endpointurl",{error: err, data: data, statuscode: res.statusCode});
                      callback(err);
                    }
                  });

                  
                },
                // ------------------------- CREATE IDENTIFIES.
                // Example curl.
                // curl -X PUT -H Content-Type: application/json -d {"fields":[{"attribute":"endpoint","value":"doug"},{"attribute":"match","value":"127.0.0.1/32"}]} http://asterisk:asterisk@172.19.0.4:8088/ari/asterisk/config/dynamic/res_pjsip/identify/doug
                // [{"attribute":"match","value":"127.0.0.1/255.255.255.255"},{"attribute":"endpoint","value":"doug"},{"attribute":"srv_lookups","value":"true"}]
                function(callback){

                  var url = server_url + "/ari/asterisk/config/dynamic/res_pjsip/identify/" + username;

                  var formData = {
                    fields: [
                      { attribute: "endpoint", value: username },
                      { attribute: "match", value: address + "/" + mask },
                    ]
                  };

                  // client.put(url, fields, function(err, req, res, data) {
                  request.put({url: url, json: formData}, function (err, res, data) {
                    
                    // log.it("pushconfig_push_debug",{formData: formData, res: res, data: data, url: url});
                    
                    if (!err && res.statusCode == 200) {
                      // Ok, do things.
                      callback(false,data);
                    } else {
                      if (!err) {
                        err = "pushconfig_identify_statuscode_error_" + res.statusCode;
                      }
                      log.error("pushconfig_error_identifyurl",{error: err, data: data, statuscode: res.statusCode});
                      callback(err);
                    }
                  });
                 
                },
                // -------------------------------- Create AORs
                // Creates an AOR for an endpoint
                /*
                curl -X DELETE http://asterisk:asterisk@172.19.0.3:8088/ari/asterisk/config/dynamic/res_pjsip/aor/doug
                curl -X PUT -H 'Content-Type: application/json' -d '{"fields":[{"attribute":"contact","value":"sip:asterisk2@127.0.0.1:5060"}]}' http://asterisk:asterisk@172.19.0.3:8088/ari/asterisk/config/dynamic/res_pjsip/aor/doug
                */
                function(callback){

                  var url = server_url + "/ari/asterisk/config/dynamic/res_pjsip/aor/" + username;

                  log.warn("pushconfig_aor_warning",{note: "we're using a static port 5060 for now, fwiw."});
                  // user@host:port
                  contact_address = 'sip:anyuser@' + address + ':5060';

                  var formData = {
                    fields: [
                      { attribute: "contact", value: contact_address },
                    ]
                  };

                  // client.put(url, fields, function(err, req, res, data) {
                  request.put({url: url, json: formData}, function (err, res, data) {
                    
                    // log.it("pushconfig_push_debug",{formData: formData, res: res, data: data, url: url});
                    
                    if (!err && res.statusCode == 200) {
                      // Ok, do things.
                      callback(false,data);
                    } else {
                      if (!err) {
                        err = "pushconfig_aor_statuscode_error_" + res.statusCode;
                      }
                      log.error("pushconfig_error_aorurl",{error: err, data: data, statuscode: res.statusCode});
                      callback(err);
                    }
                  });
                 
                },

              ],function(err,results){

                // And we're complete with the series.

                if (!err) {

                  // Let's package together what we have about this trunk.
                  var trunk_info = {
                    name: username,
                    boxid: boxid,
                    box_address: asteriskip,
                    endpoint: {
                      context: context,
                      aors: username,
                      transport: 'transport-udp',
                      allow: 'ulaw',
                      disallow: 'all',
                    },
                    identify: {
                      match: address + "/" + mask,
                    },
                    aor: {
                      contact_address: contact_address,
                    }
                  }

                  vac.discoverasterisk.storeTrunk(boxid,username,trunk_info,function(err){

                    if (!err) {

                      log.it("pushconfig_createnedpoint_complete",trunk_info);
                      callback(err,trunk_info);

                    } else {
                      callback(err);
                    }

                  });

                } else {
                  callback(err);
                }

              });

            } else {
              log.warn("pushconfig_endpoint_exists",{boxid: boxid, username: boxid, note: "tried to create an endpoint, but it already exists"});
              callback("pushconfig_createnedpoint_alreadyexists");
            }

          } else {
            callback(err);
          }

        });

      } else {
        callback(err);
      }

    });

    


  }

  this.createEndPoint = createEndPoint;


  // Checks if an endpoint exists, and returns any data about.

  // -- some references.
  // not great...
  // http://localhost:8088/ari/asterisk/config/dynamic/res_pjsip/auth/%s

  // # This worked.
  // curl http://asterisk:asterisk@172.19.0.3:8088/ari/asterisk/config/dynamic/res_pjsip/endpoint/alice

  var listEndPoint = function(boxid,endpoint,callback) {

    vac.discoverasterisk.getBoxIP(boxid,function(err,asteriskip){

      if (!err) {
        
        var server_url = "http://asterisk:asterisk@" + asteriskip + ":" + opts.sourcery_port;

        var url = server_url + "/ari/asterisk/config/dynamic/res_pjsip/endpoint/" + endpoint;

        // log.it("requested_URLLLLL",{ url: url});

        request.get({url: url}, function (err, res, data) {
          
          // log.it("pushconfig_debug_listendpoint", {res: res});

          if (!err) { //  && res.statusCode == 200
            // Alright, so we should determine if it's found or not.
            var exists = false;
            if (res.statusCode == 200) { exists = true; }
            
            callback(false,{exists: exists, data: data});

          } else {
            if (!err) {
              err = "pushconfig_endpoint_statuscode_error_" + res.statusCode;
            }
            log.error("pushconfig_error_endpointurl",{error: err, data: data, statuscode: res.statusCode});
            callback(err);
          }
        });

      } else {
        callback(err);
      }


    });

  }

  this.listEndPoint = listEndPoint;

  // Now delete an endpoint.

  var deleteEndPoint = function(boxid,username,callback) {

     vac.discoverasterisk.getBoxIP(boxid,function(err,asteriskip){

      if (!err) {

        listEndPoint(boxid,username,function(err,boxinfo){

          if (!err) {

            if (boxinfo.exists) {
              var server_url = "http://asterisk:asterisk@" + asteriskip + ":" + opts.sourcery_port;

              var urls = [];
              urls.push(server_url + "/ari/asterisk/config/dynamic/res_pjsip/endpoint/" + username);
              urls.push(server_url + "/ari/asterisk/config/dynamic/res_pjsip/identify/" + username);
              urls.push(server_url + "/ari/asterisk/config/dynamic/res_pjsip/aor/" + username);

              async.forEach(urls,function(url,callback){

                // Call the endpoint with the delete method to remove it.
                request.delete({url: url}, function (err, res, data) {
                  
                  // log.it("pushconfig_debug_delete_listendpoint", {res: res});

                  if (!err) { //  && res.statusCode == 200
                   
                    // Warn if not 200 OK
                    if (res.statusCode > 204 || res.statusCode < 200) { 
                      log.warn("pushconfig_delete_non200",{statusCode: res.statusCode, data: data, url: url});
                    }
                    
                    // Everything OK, generally.
                    callback(false);

                  } else {
                    // Couldn't quite do that, so let's debug it, a little.
                    log.error("pushconfig_error_endpointurl",{error: err, data: data, statuscode: res.statusCode, url: url});
                    callback(err);
                  }

                });

              },function(err){

                // Ok, that's all done.
                // Let's delete it from the etcd record.
                if (!err) {
                  vac.discoverasterisk.deleteStoredTrunk(boxid,username,function(err){
                    log.it("pushconfig_delete_complete",{boxid: boxid, username: username});
                    callback(err);
                  });
                } else {
                  callback(err);
                }


              });

            } else {
              log.warn("pushconfig_endpoint_exists",{boxid: boxid, username: boxid, note: "tried to create an endpoint, but it didn't exist"});
              callback("pushconfig_error_delete_endpoint_noexist");
            }

          } else {
            callback(err);
          }
        });
        
      } else {
        callback(err);
      }

    });

  }

  this.deleteEndPoint = deleteEndPoint;

}

/*

#!/usr/bin/env python

# Copyright (c)2016 Digium, Inc.
# Copyright (c)2017 Red Hat, Inc.
# Source: http://blogs.asterisk.org/2016/03/09/pushing-pjsip-configuration-with-ari/
# Original source Written by: Mark Michelson
#
# Additional development by Leif Madsen

import requests
import json
import sys

def resp_check(resp):
    """Return status code of a response from sorcery"""
    if resp.status_code == 200:
        print "Successfully pushed"
        print json.dumps(resp.json(), sort_keys=True, indent=2,
                 separators=(',', ': '))
    else:
        print "Received {0} response".format(resp.status_code)

def resp_push(url, config):
    resp = requests.put(url, auth=('asterisk', 'asterisk'), json=config)
    return resp


# base URL to connect to Asterisk ARI interface for dynamic configuration
url = "http://localhost:8088/ari/asterisk/config/dynamic/res_pjsip/"

# Add pjsip sections / users / endpoints / auths etc
sections = {}
sections['alice'] = { 'username': 'alice', 'password': 'supersecret' }
sections['bob'] = { 'username': 'bob', 'password': 'supersecret' }

# Add Transports
#  -- for now don't do this dynamically as it results in a crash.
#     see https://issues.asterisk.org/jira/browse/ASTERISK-26829
#transport_url = url + "transport/transport-udp"
#
#transport_config = {
#    'fields': [
#        { 'attribute': 'protocol', 'value': 'udp' },
#        { 'attribute': 'bind', 'value': '0.0.0.0' },
#    ]
#}
#
#transport_resp = resp_push(transport_url, transport_config)
#resp_check(transport_resp)

# Add Auths
#  -- for SIPp scenarios, we're going to authenticate via identities
#     which allows for IP based authentication.
#auth_url = url + "auth/"
#
#for k, v in sections.iteritems():
#    auth_config = {
#        'fields': [
#            { 'attribute': 'username', 'value': v['username'] },
#            { 'attribute': 'password', 'value': v['password'] },
#        ]
#    }
#
#    auth_resp = resp_push(auth_url + k, auth_config)
#    resp_check(auth_resp)

# Add Endpoints
endpoint_url = url + "endpoint/"
for k, v in sections.iteritems():
    endpoint_config = {
        'fields': [
            { 'attribute': 'transport', 'value': 'transport-udp' },
            { 'attribute': 'context', 'value': 'endpoints' },
            { 'attribute': 'disallow', 'value': 'all' },
            { 'attribute': 'allow', 'value': 'ulaw' },
        ]
    }

    endpoint_resp = resp_push(endpoint_url + k, endpoint_config)
    resp_check(endpoint_resp)

# Add Identities
identity_url = url + "identify/"

for k, v in sections.iteritems():
    identifies_config = {
        'fields': [
            { 'attribute': 'endpoint', 'value': k },
            { 'attribute': 'match', 'value': '127.0.0.2' },
        ]
    }

    identity_resp = resp_push(identity_url + k, identifies_config)
    resp_check(identity_resp)


# vim: tabstop=4 expandtab shiftwidth=4 softtabstop=4

*/