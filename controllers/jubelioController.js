const jwt        = require('jsonwebtoken');
const conn       = require('../dbConnection').promise();
const axios      = require('axios');
const { param }  = require('express/lib/request');
const logger     = require('../logs');
const cron       = require('node-cron');
const nodeBase64 = require('nodejs-base64-converter');
const conn_pg    = require('../dbConnection_pg');
const { json } = require('express');
const e = require('express');

async function getToken (req,res,next) 
{
  try 
  {
    var date = new Date();
    var expiresIn = date.getFullYear()+"-"+date.getMonth()+"-"+date.getDate()+" "+"23:59:59";

    const config = await conn_pg.query("SELECT shop.shop_configuration_id, shop.shop_id, shop.shop_name, shop.fs_id, shop.client_code, shop.client_secret FROM client cl LEFT JOIN shopconfiguration shop ON cl.client_id = shop.client_id LEFT JOIN channel ch ON shop.channel_id = ch.channel_id WHERE ch.name = 'JUBELIO' AND shop.active = 1");
    if(config.rowCount == 0)
    {
      res.json({
          status: false,
          message: "Shop not found"
      });
    }
    else
    {
        var configs = config.rows;
        configs.forEach(function(rest){
            let reqBody = {
                email: rest.client_code,
                password: rest.client_secret
            };
            var payload = JSON.stringify(reqBody);
    
            // console.log(payload);
            var axios = require('axios');
            var config = {
                method: 'POST',
                url   : 'https://api.jubelio.com/login',
                headers: { 
                    'Content-Type' : 'application/json'
                },
                data  : payload,
                validateStatus: () => true
            };
            axios(config)
            .then(async (response)=> 
            {
                var data = response.data;
                if(response.statusText == 'OK')
                {
                    // console.log(data.token);
                    let update = await conn_pg.query("UPDATE shopconfiguration SET token = $1, expires_in = $2 WHERE shop_configuration_id = $3", [data.token,expiresIn,rest.shop_configuration_id]);
                    if(update.rowCount > 0)
                    {
                        res.json({
                            status : 200,
                            message: "OK",
                            data   : "JUBELIO AUTH - SUCCESSFULLY GENERATE TOKEN FOR THIS SHOP "+rest.shop_name
                        });
                    }
                    else
                    {
                        res.json({
                            status : 500,
                            message: "FAILED",
                            data   : "JUBELIO AUTH - FAILED TO GET TOKEN FOR THIS SHOP "+rest.shop_name
                        });
                    }
                }
                else
                {
                    res.json({
                        status : false,
                        message: "failed",
                        data   : response.data
                    });
                }
            })
            .catch(function (error) 
            {
                res.json({
                    status : false,
                    message: "failed",
                    data   : "Server error"
                });
            });
        });
    }
  } 
  catch (error) 
  {
    res.json({
        status : false,
        message: "failed",
        data   : "Server error"
    }); 
  }
}

async function getProduct (req,res,next)
{
    try
    {
        const config = await conn_pg.query("SELECT shop.client_id, shop.shop_configuration_id, shop.shop_id, shop.fs_id, shop.shop_name, shop.token, shop.client_code, shop.client_secret FROM client cl LEFT JOIN shopconfiguration shop ON cl.client_id = shop.client_id LEFT JOIN channel ch ON shop.channel_id = ch.channel_id WHERE ch.name = 'JUBELIO' AND shop.active = 1 AND shop.sync_product = 1");
        if(config.rowCount == 0)
        {
          res.json({
              status: false,
              message: "Shop not found"
          });
        }
        else
        {
            // console.log(config);
            var configs = config.rows;
            configs.forEach(function(rest)
            {                
                var page = 1;
                var pageSize = 100;
                // console.log(payload);
                var axios = require('axios');
                var config = {
                    method: 'GET',
                    url   : "https://api.jubelio.com/inventory/items/?page="+page+"&pageSize="+pageSize,
                    headers: { 
                        'Content-Type' : 'application/json',
                        'authorization': rest.token
                    },
                    validateStatus: () => true
                };
                axios(config)
                .then(async (response)=> 
                {
                    var data = response.data;
                    if(response.statusText == 'OK')
                    {
                        var isNextPage = false;
                        var allGetItems = data.data;
                        var totalCount = data.totalCount;
                        var isNextPage = getNextPage(page, pageSize, totalCount);
                        // console.log(isNextPage);
                        do {
                            if (isNextPage == true) {             
                                page++;
                                // console.log(payload);
                                var axios = require('axios');
                                var config = {
                                    method: 'GET',
                                    url   : "https://api.jubelio.com/inventory/items/?page="+page+"&pageSize="+pageSize,
                                    headers: { 
                                        'Content-Type' : 'application/json',
                                        'authorization': rest.token
                                    },
                                    validateStatus: () => true
                                };
                                axios(config)
                                .then(async (response2)=> 
                                {
                                    var data2 = response2.data;
                                    if(response2.statusText == 'OK')
                                    {
                                        isNextPage = getNextPage(page, pageSize, totalCount);
                                        var nextArraygetItems = data2.data;
                                        allGetItems = arrayUnique(allGetItems.concat(nextArraygetItems));
                                    } else {
                                        res.json({
                                            status : false,
                                            message: "failed",
                                            data   : response2.data
                                        });
                                    }
                                });
                            } else {
                                break;
                            }
                        } while (isNextPage == true);
    
                        allGetItems.forEach(function(allGetItem)
                        {  
                            var variants = allGetItem.variants;

                            if (rest.fs_id) 
                            {
                                var stores = allGetItem.online_status;
                                stores.forEach(function(store)
                                {
                                    var storeId = store.store_id;
                                    if (storeId == rest.fs_id) 
                                    {
                                        variants.forEach(function(variant)
                                        {
                                            var callStore = storeItems(variant, rest.shop_configuration_id, rest.client_id);
                                            console.log(callStore);
                                        });
                                    }
                                });
                            } 
                            else 
                            {
                                variants.forEach(function(variant)
                                {
                                    var callStore = storeItems(variant, rest.shop_configuration_id, rest.client_id);
                                    console.log(callStore);
                                });
                            }
                        });
                    }
                    else
                    {
                        res.json({
                            status : false,
                            message: "failed",
                            data   : response.data
                        });
                    }
                })
                .catch(function (error) 
                {
                    res.json({
                        status : false,
                        message: "failed",
                        data   : "Server error"
                    });
                });
            });
        }
    } 
    catch (error) 
    {
        res.json({
            status : false,
            message: "failed",
            data   : "Server error"
        });
    }
}

async function getOrders (req,res,next) 
{
  try 
  {
    const config = await conn_pg.query("SELECT shop.client_id, shop.channel_id, shop.shop_configuration_id, cl.api_key, shop.shop_name, cl.multi_channel, shop.fs_id, shop.token, shop.partial_integration FROM client cl LEFT JOIN shopconfiguration shop ON cl.client_id = shop.client_id LEFT JOIN channel ch ON shop.channel_id = ch.channel_id WHERE ch.name = 'JUBELIO' AND shop.active = 1 AND shop.get_order = 1");
    if(config.rowCount == 0)
    {
      res.json({
          status: false,
          message: "Shop not found"
      });
    }
    else
    {
        var configs = config.rows;
        configs.forEach(function(rest)
        {     
            var orderType   = "Sales Order";   
            var channelName = 'JUBELIO';   
            rest.multi_channel == 1 ? stockType = 'MULTI CHANNEL' : stockType = channelName;
            var page = 1;
            var pageSize = 100;
            var axios = require('axios');
            var config = {
                method: 'GET',
                url   : "https://api.jubelio.com/sales/orders/ready-to-pick/?page="+page+"&pageSize="+pageSize,
                headers: { 
                    'Content-Type' : 'application/json',
                    'authorization': rest.token
                },
                validateStatus: () => true
            };
            axios(config)
            .then(async (response)=> 
            {
                var data = response.data;
                if(response.status == 200)
                {
                    var allGetOrders = data.data;
                    var totalCount = data.totalCount;
                    // console.log(allGetOrders);
                    do {
                        var isNextPage = getNextPage(page, pageSize, totalCount);
                        if (isNextPage == true) {             
                            page++;
                            // console.log(payload);
                            var axios = require('axios');
                            var config = {
                                method: 'GET',
                                url   : "https://api.jubelio.com/sales/orders/ready-to-pick/?page="+page+"&pageSize="+pageSize,
                                headers: { 
                                    'Content-Type' : 'application/json',
                                    'authorization': rest.token
                                },
                                validateStatus: () => true
                            };
                            axios(config)
                            .then(async (response2)=> 
                            {
                                var data2 = response2.data;
                                if(response2.status == 200)
                                {
                                    isNextPage = getNextPage(page, pageSize, totalCount);
                                    var nextArraygetOrders = data2.data;
                                    allGetOrders = arrayUnique(allGetOrders.concat(nextArraygetOrders));
                                } else {
                                    res.json({
                                        status : false,
                                        message: "failed",
                                        data   : response2.data
                                    });
                                }
                            });
                        } else {
                            break;
                        }
                    } while (isNextPage == true);
    
                    allGetOrders.forEach(function(allGetOrder)
                    {  
                        var salesOrderNo = allGetOrder.salesorder_no;
                        var sourceName   = allGetOrder.source_name;
                        var orderCode    = salesOrderNo;                        
                        var is_prefix = salesOrderNo.indexOf("-");
                        if(is_prefix) {
                            var explodeOrderCode = salesOrderNo.split("-");
                            orderCode = explodeOrderCode[1];
                        }
                        var salesOrderId = allGetOrder.salesorder_id;
                        var axios = require('axios');
                        var config = {
                            method: 'GET',
                            url   : "https://api.jubelio.com/sales/orders/"+salesOrderId,
                            headers: { 
                                'Content-Type' : 'application/json',
                                'authorization': rest.token
                            },
                            validateStatus: () => true
                        };
                        axios(config)
                        .then(async (responseSo)=> 
                        {
                            var getSalesOrder = responseSo.data;
                            if(responseSo.status == 200)
                            {
                                var locationIdJubelio = getSalesOrder.location_id;
                                let checkMappingLocations = await checkShopLocation(locationIdJubelio,rest.shop_configuration_id);
                                checkMappingLocations.forEach(async function(checkMappingLocation)
                                {                                  
                                    let isInOrders = await checkOrderCode(orderCode);
                                    // console.log(isInOrders);
                                    if(!isInOrders)
                                    {
                                        if(!rest.fs_id)
                                        {
                                            // console.log(getSalesOrder);
                                            if (rest.partial_integration == 1) 
                                            {
                                                let checkMappingChannel = await findMappingChannelByShopConfigId(rest.shop_configuration_id,sourceName);

                                                if (checkMappingChannel) 
                                                {
                                                    let callStore = await storeOrders(getSalesOrder, rest, channelName, stockType, salesOrderNo, orderCode, checkMappingLocation, sourceName, orderType);
                                                    console.log(callStore);
                                                }
                                            } 
                                            else 
                                            {    
                                                let callStore = await storeOrders(getSalesOrder, rest, channelName, stockType, salesOrderNo, orderCode, checkMappingLocation, sourceName, orderType);
                                                console.log(callStore);
                                            }   
                                        }
                                        else
                                        {
                                            var storeId = getSalesOrder.store_id;

                                            if (storeId == rest.fs_id) 
                                            {
                                                let callStore = await storeOrders(getSalesOrder, rest, channelName, stockType, salesOrderNo, orderCode, checkMappingLocation, sourceName, orderType);
                                                console.log(callStore);
                                            }
                                        }
                                    }
                                    // else{
                                    //     res.json({
                                    //         status : false,
                                    //         message: "failed",
                                    //         data   : "order code "+orderCode+" already exist"
                                    //     });
                                    // }
                                });                
                            }
                            else
                            {
                                res.json({
                                    status : false,
                                    message: "failed",
                                    data   : responseSo.data
                                });
                            }
                        })
                        .catch(function (error) 
                        {
                            res.json({
                                status : false,
                                message: "failed",
                                data   : "Server error"
                            });
                        });
                    });
                }
                else
                {
                    res.json({
                        status : false,
                        message: "failed",
                        data   : response.data
                    });
                }
            })
            .catch(function (error) 
            {
                res.json({
                    status : false,
                    message: "failed",
                    data   : "Server error"
                });
            });
        });
    }
  } 
  catch (error) 
  {
    res.json({
        status : false,
        message: "failed",
        data   : "Server error"
    });
  }
}

async function postPicklist(req,res)
{
    try
    {
        var messageSuccess = {};
        var messageError = {};
        var orderCode     = req.body.orderCode;
        if(!orderCode)
        { 
            res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Order Code Must Be Declare'
            })); 
        }
        else
        {
            if(orderCode == "")
            {
                res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Order Code Cannot Be Empty'
                })); 
            }
        }

        let orders = await checkOrderCode(orderCode);
        if(orders){
            orders.forEach(async function(order)
            {
                var picklistId = 0;
                var picklistNo = "[auto]";
                var isComplete = true;
                var shopConfigId = order.shop_configuration_id;
                var salesOrderId = order.ref_order_id;
                var channelName = "JUBELIO";
                let configs = await getAuthClientByChannelAndShopConfigId(channelName,shopConfigId);
                if(configs){
                    configs.forEach(async function(config)
                    {
                        var clientId = config.client_id;
                        var token = config.token;
                        var isAcceptOrder = config.accept_order;
                        if(isAcceptOrder == 1)
                        {
                            var picklistDetailId = 0;
                            var bundleItemId = 0;                            
                            var axios = require('axios');
                            var config = {
                                method: 'GET',
                                url   : "https://api.jubelio.com/sales/orders/"+salesOrderId,
                                headers: { 
                                    'Content-Type' : 'application/json',
                                    'authorization': token
                                },
                                validateStatus: () => true
                            };
                            axios(config)
                            .then(async (responseSo)=> 
                            {
                                var getSalesOrder = responseSo.data;
                                if(responseSo.status == 200)
                                {
                                    var items = getSalesOrder.items;
                                    var body = {};
                                    items.forEach(async function(item)
                                    {
                                        var itemIdJubelio = item.item_id;
                                        var salesDetailOrderId = item.salesorder_detail_id;
                                        var qtyOrdered = item.qty_in_base;
                                        var qtyPicked = item.qty_in_base;
                                        var locationId = item.loc_id;
                                        var fbm = item.fbm;
                                        
                                        if (fbm != 'fbl') {                                    
                                            paramsItems = [{
                                                picklist_detail_id  : picklistDetailId,
                                                item_id             : itemIdJubelio,
                                                location_id         : locationId,
                                                qty_ordered         : qtyOrdered,
                                                qty_picked          : qtyPicked,
                                                salesorder_detail_id: salesDetailOrderId,
                                                bundle_item_id      : bundleItemId,
                                                salesorder_id       : salesOrderId
                                            }];
                                            // var paramsItem = paramsItems;
                                        } 
                                        // parItems = paramsItem.concat(paramsItems);
                                    });
                                    // console.log(paramsItems);return;

                                    body = {
                                        picklist_id           : picklistId,
                                        picklist_no           : picklistNo,
                                        is_completed          : isComplete,
                                        salesorderIds         : [salesOrderId],
                                        items                 : paramsItems
                                    };
                                    var payload = JSON.stringify(body);

                                    var axios = require('axios');
                                    var config = {
                                        method: 'POST',
                                        url   : "https://api.jubelio.com/sales/picklists/",
                                        headers: { 
                                            'Content-Type' : 'application/json',
                                            'authorization': token
                                        },
                                        data  : payload,
                                        validateStatus: () => true
                                    };
                                    axios(config)
                                    .then(async (responsePick)=> 
                                    {
                                        console.log(responsePick);
                                        var data = responsePick.data;
                                        if(data.statusCode == 200)
                                        {
                                            messageSuccess = {
                                                status : 200,
                                                message : "Success PICKLIST",
                                                detail : {
                                                    data : "PICKLIST - "+orderCode+" SUCCESS POST PICKLIST"
                                                }
                                            };
                                            // console.log(messageSuccess);
                                            res.json(messageSuccess);
                                        } else {
                                            if (data.code == "23505") {
                                                messageSuccess = {
                                                    status : 200,
                                                    message : "Success PICKLIST",
                                                    detail : {
                                                        data : "PICKLIST - "+orderCode+" SUCCESS POST PICKLIST"
                                                    }
                                                };
                                                // console.log(messageSuccess);
                                                res.json(messageSuccess);
                                            }
                                            else{
                                                messageError = {
                                                    status : data.statusCode,
                                                    message : data.error,
                                                    detail : {
                                                        data : "PICKLIST - "+data.message+" FOR "+orderCode
                                                    }
                                                };
                                                // console.log(messageError);
                                                res.json(messageError);
                                            }
                                        }
                                    });

                                }
                            });
                        }   
                        else{
                            messageError = {
                                status : 401,
                                message : "NOT_AUTHORIZED",
                                detail : {
                                    data : "PICKLIST - THIS ORDER CODE "+orderCode+" DOESNT HAS PRIVILEGE TO SET FULFILLMENT"
                                }
                            };
                            // console.log(messageError);
                            res.json(messageError);
                        }
                    });
                }
            });
        }
        else{
            messageError = {
                status : 500,
                message : "FAILED GET ORDER CODE",
                detail : {
                    data : "PICKLIST - FAILED BECAUSE "+orderCode+" NOT FOUND"
                }
            };
            // console.log(messageError);
            res.json(messageError);
        }
    }
    catch (error) 
    {
        res.json({
            status : false,
            message: "failed",
            data   : "Server error"
        });
    }
}

async function postUpdateAwbCourier(req,res)
{
    try
    {
        var messageSuccess = {};
        var messageError = {};
        var orderCode = req.body.orderCode;
        if(!orderCode)
        { 
            res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Order Code Must Be Declare'
            })); 
        }
        else
        {
            if(orderCode == "")
            {
                res.send(JSON.stringify({
                    "status" : 500,
                    "message": 'failed',
                    "data"   : 'Order Code Cannot Be Empty'
                })); 
            }
        }
        
        var shopName  = req.body.shopName;
        if(!shopName)
        { 
            res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Shop Name Must Be Declare'
            })); 
        }
        else
        {
            if(shopName == "")
            {
                res.send(JSON.stringify({
                    "status" : 500,
                    "message": 'failed',
                    "data"   : 'Shop Name Cannot Be Empty'
                })); 
            }
        }

        var channelName = "JUBELIO";
        let configs = await getAuthClientByChannelAndShop(channelName,shopName);
        if(configs){
            configs.forEach(async function(config)
            {
                var isGetResi     = config.get_resi;
                var clientId      = config.client_id;
                var shopConfigId  = config.shop_configuration_id;
                    shopName      = config.shop_name;
                var isAcceptOrder = config.accept_order;
                var token         = config.token;
                if(isGetResi == 1 && isAcceptOrder == 1)
                {
                    let orders = await checkOrderCode(orderCode);
                    if(orders){
                        orders.forEach(async function(order)
                        {
                            var salesOrderId = order.ref_order_id;
                            body = {
                                ids  : [salesOrderId]
                            };

                            var payload = JSON.stringify(body);
                            var axios = require('axios');
                            var config = {
                                method: 'POST',
                                url   : "https://api.jubelio.com/sales/shipments/orders/",
                                headers: { 
                                    'Content-Type' : 'application/json',
                                    'authorization': token
                                },
                                data  : payload,
                                validateStatus: () => true
                            };
                            axios(config)
                            .then(async (postShipmentOrders)=> 
                            {
                                // console.log(postShipmentOrders);
                                var datas = postShipmentOrders.data;
                                if(postShipmentOrders.status == 200)
                                {
                                    datas.forEach(async function(data)
                                    {
                                        var courier = data.shipper;
                                        let isCourierMapped = await findCourier(courier, channelName);
                                        if(isCourierMapped){
                                            isCourierMapped.forEach(async function(CourierMapped)
                                            {
                                                var cobNumber = data.tracking_no;
                                                var deliveryTypeId = CourierMapped.delivery_type_id;
                                                var deliveryTypename = CourierMapped.shipping_type;
                                                var courierName = CourierMapped.name;
                                                var marketplaceStatus = JSON.stringify(data.marketplace_status);

                                                if (cobNumber != null) {
                                                    let updateCobHeader = await updateCobByOrderCode(orderCode, cobNumber);
                                                }

                                                let updateCourierHeader = await updateCourierByOrderHeaderId(order.order_header_id, deliveryTypeId);
                                                if(updateCourierHeader)
                                                {    
                                                    messageSuccess = {
                                                        status : 200,
                                                        message : "Ok",
                                                        detail : {
                                                            awb               : cobNumber,
                                                            delivery_type     : deliveryTypename,
                                                            courier           : courierName,
                                                            marketplace_status: marketplaceStatus
                                                        }
                                                    };
                                                    // console.log(messageSuccess);
                                                    res.json(messageSuccess);
                                                }
                                                else{
                                                    var messageFailedDetail = {
                                                        status : 500,
                                                        message : "Failed to create order",
                                                        detail : {
                                                            data : "GET ORDERS - Order code "+orderCode+" failed to create detail"
                                                        }
                                                    };
                                                    return messageFailedDetail;
                                                }
                                            });
                                        }
                                        else{
                                            messageError = {
                                                status : 500,
                                                message : "Failed to update awb courier",
                                                detail : {
                                                    data : "SET FULFILLMENT - FAILED TO UPDATE FOR THIS SHOP "+shopName+" BECAUSE, COURIER "+courier+" NOT FOUND IN MAPPING COURIER"
                                                }
                                            };
                                            // console.log(messageError);
                                            res.json(messageError);
                                        }
                                    });
                                }
                                else{
                                    messageError = {
                                        status : postShipmentOrders.status,
                                        message : "FAILED GET SALES ORDER",
                                        detail : {
                                            data : "SET FULFILLMENT - FAILED TO GET SALES ORDER FOR THIS SHOP "+shopName+" BECAUSE, "+postShipmentOrders.error
                                        }
                                    };
                                    // console.log(messageError);
                                    res.json(messageError);
                                }
                            });
                        });
                    }
                    else{
                        messageError = {
                            status : postShipmentOrders.status,
                            message : "FAILED GET ORDER CODE",
                            detail : {
                                data : "SET FULFILLMENT - FAILED TO GET ORDER CODE BECAUSE "+orderCode+" NOT FOUND"
                            }
                        };
                        // console.log(messageError);
                        res.json(messageError);
                    }
                }
                else{
                    messageError = {
                        status : 401,
                        message : "NOT_AUTHORIZED",
                        detail : {
                            data : "SET FULFILLMENT - THIS SHOP "+shopName+" DOESNT HAS PRIVILEGE TO SET FULFILLMENT"
                        }
                    };
                    // console.log(messageError);
                    res.json(messageError);
                }
            });
        }
        else{
            messageError = {
                status : 500,
                message: "FAILED GET CLIENT",
                detail : "SET FULFILLMENT - FAILED TO GET CLIENT BECAUSE "+shopName+" NOT FOUND IN SHOP CONFIGURATION"
            };
            // console.log(messageError);
            res.json(messageError);
        }
    }
    catch (error) 
    {
        res.json({
            status : false,
            message: "failed",
            data   : "Server error"
        });
    }
}

async function postInvoice(req,res)
{
    try
    {
        var messageSuccess = {};
        var messageError = {};
        var orderCode     = req.body.orderCode;
        if(!orderCode)
        { 
            res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Order Code Must Be Declare'
            })); 
        }
        else
        {
            if(orderCode == "")
            {
                res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Order Code Cannot Be Empty'
                })); 
            }
        }

        let orders = await checkOrderCode(orderCode);
        if(orders){
            orders.forEach(async function(order)
            {
                var shopConfigId = order.shop_configuration_id;
                var salesOrderId = order.ref_order_id;
                var channelName = "JUBELIO";
                let configs = await getAuthClientByChannelAndShopConfigId(channelName,shopConfigId);
                if(configs){
                    configs.forEach(async function(client)
                    {
                        var token = client.token;
                        var body = {
                            salesorder_id : salesOrderId
                        };
                        var payload = JSON.stringify(body);

                        var axios = require('axios');
                        var config = {
                            method: 'POST',
                            url   : 'https://api.jubelio.com/sales/packlists/create-invoice',
                            headers: { 
                                'Content-type' : 'application/json',
                                'authorization': token
                            },
                            data  : payload,
                            validateStatus: () => true
                        };
                        axios(config)
                        .then(async (response)=> 
                        {
                            if(response.statusCode == 200)
                            {
                                messageSuccess = {
                                    status : 200,
                                    message : "Success PICKLIST",
                                    detail : {
                                        data : "CREATE INVOICE - "+orderCode+" SUCCESS CREATE INVOICE"
                                    }
                                };
                                // console.log(messageSuccess);
                                res.json(messageSuccess);
                            } else {
                                var messagePostCreateInvoice = response.response.error;
                                messageError = {
                                    status : 500,
                                    message : 'FAILED POST CREATE INVOICE',
                                    detail : {
                                        data  : "CREATE INVOICE - FAILED TO POST CREATE INVOICE FOR THIS SHOP "+shopName+" BECAUSE, "+messagePostCreateInvoice
                                    }
                                };
                                // console.log(messageError);
                                res.json(messageError);
                            }
                        })
                        .catch(function (error) 
                        {
                            res.json({
                                status : false,
                                message: "failed",
                                data   : "Server error"
                            });
                        });
                    });
                }
            });
        }
        else{
            messageError = {
                status : 500,
                message : "FAILED GET ORDER CODE",
                detail : {
                    data : "PICKLIST - FAILED BECAUSE "+orderCode+" NOT FOUND"
                }
            };
            // console.log(messageError);
            res.json(messageError);
        }
    }
    catch (error) 
    {
        res.json({
            status : false,
            message: "failed",
            data   : "Server error"
        });
    }
}

async function printShippingLabel(req,res)
{
    try
    {
        var messageSuccess = {};
        var messageError = {};
        var orderCode     = req.body.orderCode;
        if(!orderCode)
        { 
            res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Order Code Must Be Declare'
            })); 
        }
        else
        {
            if(orderCode == "")
            {
                res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Order Code Cannot Be Empty'
                })); 
            }
        }

        let orders = await checkOrderCourierByCode(orderCode);
        if(orders){
            orders.forEach(async function(order)
            {
                var shopConfigId = order.shop_configuration_id;
                var salesOrderId = order.ref_order_id;
                var channelName = "JUBELIO";
                let configs = await getAuthClientByChannelAndShopConfigId(channelName,shopConfigId);
                if(configs){
                    configs.forEach(async function(client)
                    {
                        var token = client.token;
                        var axios = require('axios');
                        var config = {
                            method: 'GET',
                            url   : 'https://api.jubelio.com/reports/lable/print/?ids=['+salesOrderId+']',
                            headers: { 
                                'Content-type' : 'application/json',
                                'authorization': token
                            },
                            validateStatus: () => true
                        };
                        axios(config)
                        .then(async (getShippingLabel)=> 
                        {
                            if(getShippingLabel.statusCode == 200)
                            {
                                if(order.courier_name == "Shopee Express")
                                {
                                    var response_label = JSON.parse(getShippingLabel.response);
                                    messageSuccess = { 
                                        status  : 200,
                                        message : 'OK',
                                        data    : response_label.url
                                    };
                                }
                                else
                                {
                                    messageSuccess = { 
                                        status : 200,
                                        message : 'OK',
                                        data : getShippingLabel.response
                                    };
                                }

                                console.log(messageSuccess);
                            } else {
                                messageError = {
                                    status : 500,
                                    message : 'FAILED GET SHIPPING LABEL',
                                    detail : {
                                        data  : "SHIPPING LABEL - "+orderCode+" BECAUSE "+orderCode+" FROM JUBELIO"
                                    }
                                };
                                console.log(messageError);
                            }
                        })
                        .catch(function (error) 
                        {
                            res.json({
                                status : false,
                                message: "failed",
                                data   : "Server error"
                            });
                        });
                    });
                }
                else{
                    messageError = {
                        status : 500,
                        message : "FAILED GET CLIENT",
                        detail : {
                            data : "SHIPPING LABEL - FAILED BECAUSE SHOP CONFIGURATION NOT FOUND FROM THIS ORDER CODE "+orderCode
                        }
                    };
                    console.log(messageError);
                }
            });
        }
        else{
            messageError = {
                status : 500,
                message : "FAILED GET ORDER CODE",
                detail : {
                    data : "SHIPPING LABEL - FAILED BECAUSE "+orderCode+" NOT FOUND"
                }
            };
            console.log(messageError);
        }
    }
    catch (error) 
    {
        res.json({
            status : false,
            message: "failed",
            data   : "Server error"
        });
    }
}

async function postsyncStocks(req,res)
{
    try
    {
        var messageSuccess = {};
        var messageError   = {};
        var validation     = null;
        var shopConfigId   = req.body.shop_configuration_id;
        var qtyInBase      = req.body.quantity;
        var itemCode       = req.body.item_code;
        var adjusmentType  = req.body.adjustment_type;
        var locationCode   = req.body.location_code;
        
        if(!shopConfigId)
        { 
            res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Shop Config Id Must Be Declare'
            })); 
        }
        else
        {
            if(shopConfigId == "")
            {
                res.send(JSON.stringify({
                "status" : 500,
                "message": 'failed',
                "data"   : 'Shop Config Id Cannot Be Empty'
                })); 
            }
        }
        
        if(!qtyInBase)
        { 
            validation = {
                "status" : 500,
                "message": 'failed',
                "data"   : 'Quantity Must Be Declare'
            }; 
        }
        else
        {
            if(qtyInBase == "")
            {
                validation = {
                    "status" : 500,
                    "message": 'failed',
                    "data"   : 'Quantity Cannot Be Empty'
                }; 
            }
        }
        
        if(!itemCode)
        { 
            validation = {
                "status" : 500,
                "message": 'failed',
                "data"   : 'Item Code Must Be Declare'
            }; 
        }
        else
        {
            if(itemCode == "")
            {
                validation = {
                    "status" : 500,
                    "message": 'failed',
                    "data"   : 'Item Code Cannot Be Empty'
                }; 
            }
        }
        
        if(!adjusmentType)
        { 
            validation = {
                "status" : 500,
                "message": 'failed',
                "data"   : 'Adjustment Type Must Be Declare'
            }; 
        }
        else
        {
            if(adjusmentType == "")
            {
                validation = {
                    "status" : 500,
                    "message": 'failed',
                    "data"   : 'Adjustment Type Cannot Be Empty'
                }; 
            }
        }
        
        if(!locationCode)
        { 
            validation = {
                "status" : 500,
                "message": 'failed',
                "data"   : 'Location Code Must Be Declare'
            }; 
        }
        else
        {
            if(locationCode == "")
            {
                validation = {
                    "status" : 500,
                    "message": 'failed',
                    "data"   : 'Location Code Cannot Be Empty'
                }; 
            }
        }

        if(!validation)
        {
            var channelName = "JUBELIO";
            let clients = await getAuthClientByChannelAndShopConfigId(channelName,shopConfigId);
            if(clients){
                clients.forEach(async function(client)
                {
                    var clientId = client.client_id;
                    var channelId = client.channel_id;
                    var shopName = client.shop_name;                
                    var isSyncStock = client.update_stock;
                    var isMultiChannel = client.multi_channel;
                    var token = client.token;
                    var stockType = "";
                    if(isSyncStock == 1)
                    {
                        isMultiChannel == 1 ? stockType = "MULTI CHANNEL" : stockType = "JUBELIO";
                        let variants = await checkMappingItemCode(itemCode, shopConfigId);
                        if(variants){
                            variants.forEach(async function(variant)
                            {
                                let MappingLocation = await checkShopLocationCode(locationCode, shopConfigId);
                                if(MappingLocation)
                                {
                                    MappingLocation.forEach(async function(location)
                                    {                                    
                                        var locationIntegrationCode = location.partner_code;
                                        var productUrl = variant.product_url;
                                        var date = new Date();
                                        var transactionDate = date.toISOString();
                                        var itemAdjDetailId = 0;
                                        var variantId = variant.variant_id;
                                        var serialNo = null;
                                        var itemAdjId = 0;
                                        var itemAdjNo = "[auto]";
                                        var itemId = variant.item_id;
                                        var amount = 1;

                                        if (adjusmentType == "inbound") 
                                        {
                                            qtyInBase = qtyInBase;
                                        } 
                                        else if (adjusmentType == "outbound") 
                                        {
                                            qtyInBase = 0 - qtyInBase;
                                        }

                                        if(productUrl)
                                        {
                                            var axios = require('axios');
                                            var config = {
                                                method: 'GET',
                                                url   : productUrl,
                                                headers: { 
                                                    'Content-Type' : 'application/json',
                                                    'authorization': token
                                                },
                                                validateStatus: () => true
                                            };
                                            axios(config)
                                            .then(async (responseAdj)=> 
                                            {
                                                var dataAdjs = responseAdj.data;
                                                if(responseAdj.status == 200)
                                                {
                                                    // console.log(dataAdjs.items[0]);
                                                    itemAdjId = dataAdjs.item_adj_id;
                                                    itemAdjNo = dataAdjs.item_adj_no;
                                                    itemAdjDetailId = dataAdjs.items[0].item_adj_detail_id;
                                                    serialNo = dataAdjs.items[0].serial_no;
                                                    var quantity = dataAdjs.items[0].qty;
                                                    qtyInBase = qtyInBase - quantity;
                                                }
                                            });
                                        }

                                        const items = [{
                                            item_adj_detail_id    : itemAdjDetailId,
                                            item_id               : variantId,
                                            serial_no             : serialNo,
                                            qty_in_base           : qtyInBase,
                                            uom_id                : -1,
                                            unit                  : 'Buah',
                                            cost                  : 0,
                                            amount                : amount,
                                            location_id           : locationIntegrationCode,
                                            account_id            : 75,
                                            description           : ''
                                        }];
                                        
                                        const body = {
                                            item_adj_id           : itemAdjId,
                                            item_adj_no           : itemAdjNo,
                                            transaction_date      : transactionDate,
                                            note                  : '',
                                            location_id           : locationIntegrationCode,
                                            is_opening_balance    : false,
                                            items                 : items
                                        };
                                        var payload = JSON.stringify(body);

                                        var axios = require('axios');
                                        var config = {
                                            method: 'POST',
                                            url   : "https://api.jubelio.com/inventory/adjustments/",
                                            headers: { 
                                                'Content-Type' : 'application/json',
                                                'authorization': token
                                            },
                                            data  : payload,
                                            validateStatus: () => true
                                        };
                                        axios(config)
                                        .then(async (response)=> 
                                        {
                                            var data = response.data;
                                            // console.log(response);
                                            if(response.status == 200)
                                            {
                                                var updateProductUrl = "https://api.jubelio.com/inventory/adjustments/"+data.id;
                                                var update = updateProductUrlInMappingItem(itemId,shopConfigId,variantId,updateProductUrl);
                                                if(update)
                                                {
                                                    messageSuccess = {
                                                        status : 200,
                                                        message : "Success Sync Stock",
                                                        detail : {
                                                            data : "SYNC STOCK - "+itemCode+" HAS UPDATED SUCCESSFULLY"
                                                        }
                                                    };
                                                }
                                                else{
                                                    messageSuccess = {
                                                        status : 200,
                                                        message : "Success Sync Stock",
                                                        detail : {
                                                            data : "SYNC STOCK - "+itemCode+" HAS UPDATED SUCCESSFULLY"
                                                        }
                                                    };
                                                }
                                                // console.log(messageSuccess);
                                                res.json(messageSuccess);
                                            } else {
                                                messageError = {
                                                    status : data.statusCode,
                                                    message : data.error,
                                                    detail : {
                                                        data : "SYNC STOCK - "+data.message+" FOR "+shopName
                                                    }
                                                };
                                                // console.log(messageError);
                                                res.json(messageError);
                                            }
                                        });
                                    });
                                }   
                                else{
                                    messageError = {
                                        status : 400,
                                        message : "FAILED SYNC STOCK",
                                        data : "SYNC STOCK - FAILED TO SYNC STOCK FOR THIS SHOP "+shopName+" BECAUSE "+locationCode+" IS NOT FOUND IN MAPPING LOCATION"
                                    };
                                    // console.log(messageError);
                                    res.json(messageError);
                                }
                            });
                        }
                        else{
                            messageError = {
                                status : 500,
                                message : "FAILED SYNC STOCK",
                                detail : {
                                    data : "SYNC STOCK - This Item "+itemCode+" doesnt has variants"
                                }
                            };
                            // console.log(messageError);
                            res.json(messageError);
                        }
                    }
                    else{
                        messageError = {
                            status : 500,
                            message : "FAILED SYNC STOCK",
                            detail : {
                                data : "SYNC STOCK - This shop "+shopName+" doesnt has privilege to sync stock "
                            }
                        };
                        // console.log(messageError);
                        res.json(messageError);
                    }
                });
            }
            else{
                messageError = {
                    status : 500,
                    message : "FAILED SYNC STOCKT",
                    detail : {
                        data : "SYNC STOCK - FAILED BECAUSE SHOP CONFIGURATION NOT FOUND FROM THIS ID "+shopConfigId
                    }
                };
                // console.log(messageError);
                res.json(messageError);
            }
        }
        else{
            // console.log(validation);
            res.json(validation);
        }
    }
    catch (error) 
    {
        res.json({
            status : false,
            message: "failed",
            data   : "Server error"
        });
    }
}

//store
async function storeItems(variant, shop_configuration_id, client_id,res)
{
    result = {};
    var itemId         = variant.item_group_id;      // Product Id in Mapping Item
    var itemCodes      = variant.item_code;
    var itemCode       = itemCodes.toUpperCase();  // Product Code in Mapping Item
    var itemName       = variant.item_name;        // Product Name in Mapping Item
    var variantId      = variant.item_id;          // Variant Id in Mapping Item
    var itemProductUrl = null;

    // var checkMappingItems    = checkMappingVariant(variantId, shop_configuration_id);
    let result_mapping = await conn_pg.query("SELECT product_code,product_name FROM mappingitem WHERE variant_id = $1 AND shop_configuration_id = $2", [variantId,shop_configuration_id]);
    var checkMappingItems = result_mapping.rows;
    const checkMapping = Promise.all(checkMappingItems.map(async (checkMappingItem) => 
    {
        // console.log(checkMappingItem);    
        if(checkMappingItem == "")
        {
            // console.log("new");        
            // var chekItem = checkItem(itemCode, client_id);
            let checkItem = await conn_pg.query("SELECT item_id FROM item WHERE code = $1 AND client_id = $2", [itemCode,client_id]);
            var chekItems = checkItem.rows;
            chekItems.forEach(function(chekItem)
            {  
                if (chekItem) 
                {
                    // console.log("adaitemid");   
                    var insert = insertIntoMappingItem(chekItem.item_id,shop_configuration_id,itemId,itemCode,itemName,itemProductUrl,variantId);
                    if(insert != "")
                    {
                        var messageNullItemId = {
                            status : 200,
                            message : "Success Mapping Item",
                            detail : {
                                data : "MAPPING ITEM - "+itemCode+" has mapped successfully"
                            }
                        };
                        console.log(messageNullItemId);
                        // res.json({messageNullItemId});
                    }
                } 
                else 
                {
                    // console.log("gadaitemid");
                    var insert = insertIntoMappingItemWithNullItemId(shop_configuration_id,itemId,itemCode,itemName,itemProductUrl,variantId);
                    if(insert != "")
                    {
                        var messageNullItemId = {
                            status : 500,
                            message : "Mapping With Null Item Id",
                            detail : {
                                data : "MAPPING ITEM - Mapping With Null Item Id For "+itemCode+" cause by No Reference Found in MASTER ITEM"
                            }
                        };
                        console.log(messageNullItemId);
                        // res.json({messageNullItemId});
                    }
                }
            });
        }
        else
        {
            if(checkMappingItem.product_code != itemCode || checkMappingItem.product_name != itemName)
            {
                // console.log("updatebeda");
                // var chekItem = checkItem(itemCode, client_id);
                let checkItem = await conn_pg.query("SELECT item_id FROM item WHERE code = $1 AND client_id = $2", [itemCode,client_id]);
                var chekItems = checkItem.rows;
                chekItems.forEach(function(chekItem)
                {  
                    if (chekItem) 
                    {
                        var update = updateMappingItemByVariantAndShop(chekItem.item_id,itemCode,variantId,shop_configuration_id);
                        if(update != "")
                        {
                            var messageUpdate = {
                                status : 200,
                                message : "Success Update Mapping",
                                detail : {
                                    data : "MAPPING ITEM - "+itemCode+" has been updated succesfully"
                                }
                            };
                            console.log(messageUpdate);
                            // res.json({messageUpdate});
                        }
                    }
                    else 
                    {
                        var messageFailedUpdate = {
                            status : 500,
                            message : "Failed",
                            detail : {
                                data : "Failed while update mapping item because Item Code "+itemCode+" is not exist in Haistar System. Please regist this item first or update sku on old item."
                            }
                        };
                        console.log(messageFailedUpdate);
                        // res.json({messageFailedUpdate});
                    }
                });
            }
            else
            {
                var messageAlreadyExist = {
                    status : 500,
                    message : "Item Already Exist",
                    detail : {
                        data : "MAPPING ITEM - Itemcode "+itemCode+" has exist in MAPPING ITEM but item id is null"
                    }
                };
                console.log(messageAlreadyExist);
                // res.json({messageAlreadyExist});
            }
        }
    }));
}

async function storeOrders(getSalesOrder, Configuration, channelName, stockType, salesOrderNo, orderCode, location, sourceName, orderType)
{
    let pg = await conn_pg.connect();
    try
    {
        await pg.query('BEGIN')
        var messageSuccessOrder = {};
        var itemModel           = [];
        var noItemModel         = {};
        var noItemModelNull     = {};
        var noItemMapping       = {};
        var shopConfigurationId = Configuration.shop_configuration_id;
        var clientId            = Configuration.client_id;
        var channelId           = Configuration.channel_id;
        var locationId          = location.locationid;
        var items               = getSalesOrder.items;
        var notes               = channelName+"-"+sourceName;
        var remark              = getSalesOrder.note;
        var salesOrderNo        = salesOrderNo.replace(/ /g, "");
        var orderCode           = orderCode.replace(/ /g, "");
        var stockSource         = "GOOD STOCK";

        if (getSalesOrder.is_cod == true) {
            var paymentType = "COD";

            if (sourceName == "SHOPEE") {
                var codPrice = parseInt(getSalesOrder.total_amount_mp);
            } else if (sourceName == "LAZADA") {
                var codPrice = parseInt(getSalesOrder.grand_total + getSalesOrder.buyer_shipping_cost);
            } else {
                var codPrice = parseInt(getSalesOrder.grand_total);
            }
        } else {
            var paymentType = "NON COD";
            var codPrice = 0;
        }

        var paymentId = 0;
        if(paymentType == "COD")
        {
            paymentId = 1;
        }
        else
        {
            paymentId = 2;
        }

        if (!getSalesOrder.shipper) {
            if (sourceName == "LAZADA") {
                var courier = "Lazada Express";
            } else {
                var courier = "JNE REG";
            }
        } else {
            var courier = getSalesOrder.shipper;
        }

        let isStockTypes = await checkStockType(clientId,stockType);
        if(isStockTypes){
            isStockTypes.forEach(async function(isStockType)
            {
                var stockTypeId = isStockType.stock_type_id;
                if(orderType == 'Sales Order')
                {
                    var orderTypeId = 1;
                }
                let isCourierMapped = await findCourier(courier, channelName); 
                if(isCourierMapped)
                {
                    isCourierMapped.forEach(async function(CourierMapped)
                    {  
                        if(CourierMapped)
                        {
                            var discountPoint    = parseInt(getSalesOrder.total_disc);
                            var discountSeller   = 0;
                            var discountPlatform = 0;
                            var shippingPrice    = parseInt(getSalesOrder.shipping_cost);
                            var date             = getSalesOrder.created_date.replace('T', " ");
                            var timeStamp        = date.replace('.991Z', "");
                            var name             = getSalesOrder.shipping_full_name;
                            var phone            = "-";
                            if(getSalesOrder.shipping_phone)
                            {
                                phone = getSalesOrder.shipping_phone;
                            }

                            var address       = getSalesOrder.shipping_address+", "+getSalesOrder.shipping_area+", "+getSalesOrder.shipping_city+", "+getSalesOrder.shipping_province+", "+getSalesOrder.shipping_country;
                            var email         = null;
                            var district      = getSalesOrder.shipping_area;
                            var city          = getSalesOrder.shipping_city;
                            var province      = getSalesOrder.shipping_province;
                            var country       = getSalesOrder.shipping_country;
                            var postal_code   = getSalesOrder.shipping_post_code;
                            var refOrderId    = getSalesOrder.salesorder_id;
                            var bookingNumber = getSalesOrder.tracking_no;
                            var waybillNumber = "";
                            var totalPrice    = parseInt(getSalesOrder.grand_total);
                            var remarks       = getSalesOrder.customer_name+" - "+salesOrderNo+" - "+remark;
                            // console.log(CourierMapped);
                            let insert = await insertIntoHeaderOrder(orderCode, clientId, channelId, shopConfigurationId, stockTypeId, orderTypeId, CourierMapped.delivery_type_id, locationId, refOrderId, bookingNumber, waybillNumber, totalPrice, name, phone, address, email, district, city, province, country, postal_code, timeStamp, discountPoint, discountSeller, discountPlatform, shippingPrice, paymentId, codPrice, remarks, notes, stockSource);
                            if(insert)
                            {    
                                insert.forEach(async function(orderHeader)
                                {      
                                    let insertJobPush = await insertIntoJobPushOrder(orderHeader.order_header_id);
                                    if(insertJobPush)
                                    {
                                        let insertHistory = await insertIntoHistoryOrder(orderHeader.order_header_id,orderHeader.status_id);
                                        if(!insertHistory)
                                        {
                                            pg.query("ROLLBACK");
                                        }  
                                        
                                        let insertTmpretry = await insertIntoTmpRetry(orderHeader.order_header_id,channelId,shopConfigurationId,refOrderId);
                                        if(!insertTmpretry)
                                        {
                                            pg.query("ROLLBACK");
                                        }

                                        items.forEach(async function(item)
                                        {  
                                            var fbm = item.fbm;
                                            if(fbm != "fbl")
                                            {                
                                                var variantId = item.item_id;
                                                var itemCode = item.item_code;
                                                let isInMappings = await checkMappingVariant(variantId,shopConfigurationId);   
                                                if(isInMappings)   
                                                {  
                                                    isInMappings.forEach(async function(isInMapping)
                                                    {  
                                                        if(isInMapping.item_id != null)
                                                        {
                                                            var weight         = parseInt(item.weight_in_gram);
                                                            var unit_price     = parseInt(item.original_price);
                                                            var totalUnitPrice = parseInt(item.qty_in_base*item.original_price);
                                                            var quantity       = parseInt(item.qty_in_base);
                                                            let insertDetail = await insertIntoDetailOrder(orderCode, orderHeader.order_header_id, isInMapping.item_id, quantity, unit_price, totalUnitPrice, weight);
                                                            if(insertDetail)
                                                            {    
                                                                messageSuccessOrder = {
                                                                    status : 200,
                                                                    message : "Success Create Order",
                                                                    detail : {
                                                                        data : "GET ORDERS - Order code "+orderCode+" has created header and detail successfully"
                                                                    }
                                                                };
                                                                console.log(messageSuccessOrder);
                                                            }
                                                            else{
                                                                pg.query("ROLLBACK");
                                                                var messageFailedDetail = {
                                                                    status : 500,
                                                                    message : "Failed to create order",
                                                                    detail : {
                                                                        data : "GET ORDERS - Order code "+orderCode+" failed to create detail"
                                                                    }
                                                                };
                                                                return messageFailedDetail;
                                                            }
                                                        }
                                                        else
                                                        {
                                                            pg.query("ROLLBACK");
                                                            var messageAlreadyExist = {
                                                                status : 500,
                                                                message : "Item Not Mapping",
                                                                detail : {
                                                                    data : "GET ORDERS - Itemcode "+variantId+" Not Mapping Item_id"
                                                                }
                                                            };
                                                            console.log(messageAlreadyExist);
                                                        }
                                                    });
                                                }
                                                else
                                                {
                                                    pg.query("ROLLBACK");
                                                    var messageAlreadyExist = {
                                                        status : 500,
                                                        message : "Item Not Mapping",
                                                        detail : {
                                                            data : "GET ORDERS - Itemcode "+variantId+" Not Mapping"
                                                        }
                                                    };
                                                    console.log(messageAlreadyExist);
                                                }
                                            }
                                            else{
                                                pg.query("ROLLBACK");
                                            }
                                        });
                                    }
                                    else{
                                        pg.query("ROLLBACK");
                                    }
                                });
                            }
                            else{
                                pg.query("ROLLBACK");
                                var messageAlreadyExist = {
                                    status : 500,
                                    message : "Failed to create order",
                                    detail : {
                                        data : "ORDERCODE "+orderCode+" FAILED TO CREATE HEADER"
                                    }
                                };
                                return messageAlreadyExist;
                            }
                        }
                    });
                } 
                else{
                    var messageAlreadyExist = {
                        status : 500,
                        message : "Failed to create order",
                        detail : {
                            data : "ORDERCODE "+orderCode+" FAILED TO CREATE BECAUSE, COURIER "+courier+" NOT FOUND IN MAPPING COURIER"
                        }
                    };
                    console.log(messageAlreadyExist);
                }
            });
        }
        else
        {
            var messageAlreadyExist = {
                status : 500,
                message : "Stock Type Not Mapping",
                detail : {
                    data : "GET ORDERS - Stock Type "+stockType+" Not Mapping"
                }
            };
            console.log(messageAlreadyExist);
        }
    } 
    catch (error) 
    {
        // transaction.rollback();
        res.json({
            status : false,
            message: "failed",
            data   : "Server error"
        });
    }
}

//function cek data
async function getNextPage(page, pageSize, totalCount)
{
    var offset = page * pageSize;
    var theRest = totalCount - offset;
    theRest > 0 ? NextPage = true : NextPage = false;
    console.log(NextPage);
    // return NextPage;
}

async function getAuthClientByChannelAndShopConfigId(channelName,shopConfigId)
{
    var resultdetail = "";
    let select = await conn_pg.query("SELECT cl.client_id, cl.multi_channel, ch.channel_id, shop.token, shop.accept_order, shop.shop_name, shop.update_stock FROM client cl LEFT JOIN shopconfiguration shop ON cl.client_id = shop.client_id LEFT JOIN channel ch ON shop.channel_id = ch.channel_id WHERE shop.active = 1 AND ch.name = $1 AND shop.shop_configuration_id = $2",[channelName,shopConfigId]);
    resultdetail = select.rows;
    if(select.rowCount > 0)
    {
        return resultdetail;
    }
}

async function getAuthClientByChannelAndShop(channelName,shopName)
{
    var resultdetail = "";
    let select = await conn_pg.query("SELECT cl.client_id,shop.token,shop.accept_order,shop.get_resi,shop.shop_configuration_id,shop.shop_name FROM client cl LEFT JOIN shopconfiguration shop ON cl.client_id = shop.client_id LEFT JOIN channel ch ON shop.channel_id = ch.channel_id WHERE shop.active = 1 AND ch.name = $1 AND shop.shop_name = $2",[channelName,shopName]);
    resultdetail = select.rows;
    if(select.rowCount > 0)
    {
        return resultdetail;
    }
}

async function checkShopLocation(locationId,shopConfigId)
{
    let sql = await conn_pg.query("SELECT sl.location_channel, l.name AS location_name, l.code AS location_code, l.location_id AS locationId FROM shoplocation sl LEFT JOIN location l ON sl.location_id = l.location_id WHERE sl.location_channel = $1 AND sl.shop_configuration_id= $2",[locationId,shopConfigId]);
    var results = sql.rows;
    if(sql.rowCount > 0)
    {
        return results;
    }
}

async function checkShopLocationCode(locationCode,shopConfigId)
{
    let sql = await conn_pg.query("SELECT sl.location_channel AS partner_code FROM shoplocation sl JOIN location l ON sl.location_id = l.location_id WHERE is_active = 1 AND l.code = $1 AND sl.shop_configuration_id= $2",[locationCode,shopConfigId]);
    var results = sql.rows;
    if(sql.rowCount > 0)
    {
        return results;
    }
}

async function checkOrderCode(orderCode)
{
    var resIsInOrders = "";
    let res_isInOrder = await conn_pg.query("SELECT order_header_id, ref_order_id, shop_configuration_id, code, order_code FROM orderheader WHERE order_code = $1",[orderCode]);
    var resIsInOrders = res_isInOrder.rows;
    if(res_isInOrder.rowCount > 0)
    {
        return resIsInOrders;
    }
}

async function findMappingChannelByShopConfigId(shopConfigId, channelName)
{
    let sql = await conn_pg.query("SELECT mc.channel_name as channel_name FROM mappingchannel mc JOIN shopconfiguration shop ON mc.shop_config_id = shop.shop_configuration_id WHERE shop.shop_configuration_id= $1 AND mc.channel_name = $2 AND mc.get_order = '1'",[shopConfigId, channelName]);
    var results = sql.rows;
    if(sql.rowCount > 0)
    {
        results.forEach(function(result)
        {  
            return result;
        });
    }
}

async function checkMappingVariant(variantId, shopConfigId)
{
    let result_mapping = await conn_pg.query("SELECT item_id,product_code,product_name,variant_id FROM mappingitem WHERE variant_id = $1 AND shop_configuration_id = $2", [variantId,shopConfigId]);
    var checkMappingItems = result_mapping.rows;
    if(result_mapping.rowCount > 0)
    {
        return checkMappingItems;
    }
}

async function checkMappingItemCode(itemCode, shopConfigId)
{
    let result_mapping = await conn_pg.query("SELECT mi.variant_id, mi.product_url, mi.item_id FROM mappingitem mi LEFT JOIN shopconfiguration sc ON mi.shop_configuration_id = sc.shop_configuration_id LEFT JOIN item i ON mi.item_id = i.item_id WHERE mi.shop_configuration_id = $1 AND i.code = $2", [shopConfigId,itemCode]);
    var checkMappingItems = result_mapping.rows;
    if(result_mapping.rowCount > 0)
    {
        return checkMappingItems;
    }
}

async function findCourier(courier, channelName)
{
    // console.log(channelName);
    let selectCourier = await conn_pg.query("SELECT dt.delivery_type_id, mc.courier_name as shipping_method, dt.name as shipping_type, c.name, ch.name as channel_name FROM mappingcourier mc LEFT JOIN deliverytype dt ON mc.delivery_type_id=dt.delivery_type_id LEFT JOIN courier c ON dt.courier_id=c.courier_id LEFT JOIN channel ch ON mc.channel_id=ch.channel_id WHERE mc.courier_name = $1 AND ch.name = $2", [courier,channelName]);
    var Courier = selectCourier.rows;
    if(selectCourier.rowCount > 0)
    {
        return Courier;
    }
}

async function checkStockType(clientId,stockType)
{
    var restockTypes = "";
    let res_stockType = await conn_pg.query("SELECT stock_type_id FROM stocktype WHERE client_id = $1 AND name = $2",[clientId,stockType]);
    restockTypes = res_stockType.rows;
    if(res_stockType.rowCount > 0)
    {
        return restockTypes;
    }
}

async function checkOrderCourierByCode(orderCode)
{
    var resIsInOrders = "";
    let res_isInOrder = await conn_pg.query("SELECT oh.shop_configuration_id, od.item_id, i.code as item_code, oh.ref_order_id as sales_order_id, oh.waybill_number, c.name as courier_name, dt.name as delivery_type_name FROM orderdetail od JOIN orderheader oh ON od.order_header_id = oh.order_header_id JOIN item i ON od.item_id = i.item_id JOIN deliverytype dt ON oh.delivery_type_id = dt.delivery_type_id JOIN courier c ON dt.courier_id = c.courier_id WHERE oh.order_code = $1",[orderCode]);
    var resIsInOrders = res_isInOrder.rows;
    if(res_isInOrder.rowCount > 0)
    {
        return resIsInOrders;
    }
}

//insert
async function insertIntoMappingItem(item_id,shop_configuration_id,itemId,itemCode,itemName,itemProductUrl,variantId)
{
  let data = await conn_pg.query("INSERT INTO mappingitem (item_id, shop_configuration_id, product_id, product_code, product_name, product_url, variant_id, active, created_date, modified_date, created_by, modified_by) VALUES ($1,$2,$3,$4,$5,$6,$7,1,NOW(),NOW(),0,0)",[item_id,shop_configuration_id,itemId,itemCode,itemName,itemProductUrl,variantId]);
  if(data.rowCount == 0)
  {
    console.log("Success");
  }
}

async function insertIntoMappingItemWithNullItemId(shop_configuration_id,itemId,itemCode,itemName,itemProductUrl,variantId)
{
  let data = await conn_pg.query("INSERT INTO mappingitem (shop_configuration_id, product_id, product_code, product_name, product_url, variant_id, active, created_date, modified_date, created_by, modified_by) VALUES ($1,$2,$3,$4,$5,$6,1,NOW(),NOW(),0,0)",[shop_configuration_id,itemId,itemCode,itemName,itemProductUrl,variantId]);
  if(data.rowCount == 0)
  {
    console.log("Success");
  }
}

async function updateMappingItemByVariantAndShop(item_id, itemCode, variantId, shop_configuration_id)
{
  let data = await conn_pg.query("UPDATE mappingitem SET item_id = $1, product_code = $2 WHERE variant_id = $3 AND shop_configuration_id = $4",[item_id,itemCode,variantId,shop_configuration_id]);
  if(data.rowCount == 0)
  {
    console.log("Success");
  }
}

async function updateCobByOrderCode(orderCode, cobNumber)
{
    let updateResi = await conn_pg.query("UPDATE orderheader SET booking_number = $1 WHERE code = $2",[orderCode,cobNumber]);
    updateCob = updateResi.rows;
    if(updateResi.rowCount > 0)
    {
        return updateCob;
    }
}

async function updateCourierByOrderHeaderId(orderHeaderId, deliveryTypeId)
{
    let updateCouriers = await conn_pg.query("UPDATE orderheader SET delivery_type_id = $1 WHERE order_header_id  = $2",[deliveryTypeId,orderHeaderId]);
    updateCourier = updateCouriers.rows;
    if(updateCouriers.rowCount > 0)
    {
        return updateCourier;
    }
}

async function updateProductUrlInMappingItem(itemId, shopConfigId, variantId, productUrl)
{
    let updateUrls = await conn_pg.query("UPDATE mappingitem SET product_url = $1 WHERE item_id = $2 AND shop_configuration_id = $3 AND variant_id = $4",[productUrl,itemId,shopConfigId,variantId]);
    updateUrl = updateUrls.rows;
    if(updateUrls.rowCount > 0)
    {
        return updateUrl;
    }
}

async function insertIntoHeaderOrder(orderCode, clientId, channelId, shopConfigurationId, stockTypeId, orderTypeId, deliveryTypeId, locationId, refOrderId, bookingNumber, waybillNumber, totalPrice, recipientName, recipientPhone, recipientAddress, recipientEmail, recipientDistrict, recipientCity, recipientProvince, recipientCountry, recipientPostalCode, timeStamp, discountPoint, discountSeller, discountPlatform, shippingPrice, paymentId, codPrice, remarks, notes, stockSource)
{
    var statusId = 70;
    var createdName = "Automatic By System API";
    let data = await conn_pg.query("INSERT INTO orderheader(order_code, location_id, client_id, shop_configuration_id, status_id, delivery_type_id, payment_type_id, channel_id, stock_type_id, order_type_id, ref_order_id, code, order_date, booking_number, waybill_number, recipient_name, recipient_phone, recipient_email, recipient_address, recipient_district, recipient_city, recipient_province, recipient_country, recipient_postal_code, latitude, longitude, total_koli, shipping_price, total_price, cod_price, dfod_price, stock_source, notes, remark, created_date, modified_date, created_by, modified_by, created_name, store_name, discount, discount_shipping, discount_point, discount_seller, discount_platform, total_product_price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, 0, 0, 0, $25, $26, $27, 0, $28, $29, $30, NOW(), NOW(), 0, 0, $31, $30, 0, 0, $32, $33, $34, 0) RETURNING order_header_id, status_id",[orderCode, locationId, clientId, shopConfigurationId, statusId, deliveryTypeId, paymentId, channelId, stockTypeId, orderTypeId, refOrderId, orderCode, timeStamp, bookingNumber, waybillNumber, recipientName, recipientPhone, recipientEmail, recipientAddress, recipientDistrict, recipientCity, recipientProvince, recipientCountry, recipientPostalCode, shippingPrice, totalPrice, codPrice, stockSource, notes, remarks, createdName, discountPoint, discountSeller, discountPlatform]);
    var datas = data.rows;
    if(data.rowCount > 0)
    {
        return datas;
    }
}

async function insertIntoDetailOrder(orderCode, headerId, itemId, orderQuantity, unitPrice, totalUnitPrice, unitWeight)
{
    var statusId = 70;
    let data = await conn_pg.query("INSERT INTO orderdetail(order_code, order_header_id, item_id, order_quantity, unit_price, total_unit_price, unit_weight, status_id, created_date, modified_date, created_by, modified_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), 0, 0)",[orderCode, headerId, itemId, orderQuantity, unitPrice, totalUnitPrice, unitWeight, statusId]);
    var datas = data.rows;
    if(data.rowCount > 0)
    {
        return datas;
    }
}

async function insertIntoHistoryOrder(headerId,statusId)
{
    var createdName = "Automatic By System API";
    let data = await conn_pg.query("INSERT INTO orderhistory(order_header_id, status_id, updated_by, update_date, created_date, created_by, modified_by) VALUES ($1, $2, $3, NOW(), NOW(), 0, 0)",[headerId, statusId, createdName]);
    var datas = data.rows;
    if(data.rowCount > 0)
    {
        return datas;
    }
}

async function insertIntoJobPushOrder(headerId)
{
    let data = await conn_pg.query("INSERT INTO jobpushorder(order_header_id, created_date) VALUES($1, NOW())",[headerId]);
    var datas = data.rows;
    if(data.rowCount > 0)
    {
        return datas;
    }
}

async function insertIntoTmpRetry(headerId,channelId,shopConfigurationId,refOrderId)
{
    let data = await conn_pg.query("INSERT INTO tmpretry(channel_id, shop_configuration_id, order_header_id, order_code, acked, counter_ack, created_date, modified_date, created_by, modified_by) VALUES($1, $2, $3, $4, 0, 0, NOW(), NOW(), 0, 0)",[channelId,shopConfigurationId,headerId,refOrderId]);
    var datas = data.rows;
    if(data.rowCount > 0)
    {
        return datas;
    }
}

module.exports ={
    getToken,
    getProduct,
    getOrders,
    postPicklist,
    postUpdateAwbCourier,
    postInvoice,
    printShippingLabel,
    postsyncStocks
}