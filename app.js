'use strict'; /* globals Parse: false */  /* globals require: false */
// These two lines are required to initialize Express in Cloud Code.
var express = require('express');
var app = express();
var logIndex = 1;

var bodyParser = require('body-parser');

//requires
var rss = require('rss');
/*
var tough = require('tough-cookie')

var cookieStore = new tough.MemoryCookieStore();
//var cookieStore = tough.MemoryCookieStore;

var CookieJar = new tough.CookieJar(cookieStore);
  
var request = require('request');
var request =  request.defaults({jar: true});
//request.cookies = request.jar();
request = request.jar(cookieStore);
request.cookies = request._jar;
request.cookies.store.synchronous = true;

console.log( cookieStore.constructor.name);
console.log( CookieJar.constructor.name);
console.log( CookieJar.store.constructor.name);

console.log( request.cookies.store.constructor.name);

console.log((request._jar && request._jar.setCookie));
*/

var request = require('request');
var j = request.jar()
request = request.defaults({jar:j})

console.log((request._jar && request._jar.setCookie));

//functions

function htmlspecialchars(html) {
  if (typeof html !=='string'){
    html = html.toString();
  }
  // Сначала необходимо заменить &
  html = html.replace(/&/g, "&amp;");
  // А затем всё остальное в любой последовательности
  html = html.replace(/</g, "&lt;");
  html = html.replace(/>/g, "&gt;");
  html = html.replace(/"/g, "&quot;");
  // Возвращаем полученное значение
  return html;
}

//cookies to DB
function saveCookies(cookies){//return promise
  var promises = [];
  for (var key in cookies) {
    var cookieQuery = new Parse.Query('Cookie');
    cookieQuery.equalTo('name',cookies[key].name);
    promises.push(cookieQuery.find().then(function(){
      var cookie = cookies[key];
      return function(results) {
        var dbCookie;
        if (results.length>0) {
          dbCookie = results[0];
        } else {
          dbCookie = new Parse.Object('Cookie');
        }
        dbCookie.set('name',cookie.name);
        dbCookie.set('value',cookie.value);
        dbCookie.set('expires',cookie.options.expires);
        dbCookie.set('domain',cookie.options.domain);
        return dbCookie.save();
      };
     }()
    ));
  }
  return Parse.Promise.when(promises);
}

//Безопасно получить блок из результата str.match
function safeGet(match,index){
  if (match !== null && match.length > index &&
      typeof match[2] === 'string' && match[2].length > 0) {
    return match[index];
  }
  else {
    return null;
  }
}
//Получить имя хоста из урла
function getHostName(url) {
  return safeGet(url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i),2)
}

// получить набор строк для фильтра Cookies
function getDomainsList(domain){
  var result = [];
  result.push(domain);
  var domainWords = domain.split('.');
  while (domainWords.length > 1) {
    result.push('.'+domainWords.join('.'));
    domainWords.shift();
  }
  return result;
}

//Получить строку куков по домену
function getCookies(domain){
  var result='';
  var query = new Parse.Query('Cookie');
  query.containedIn('domain',getDomainsList(domain));
  var q = new Parse.Query('Cookie');
  q.greaterThan('expires', new Date());
  var q1 = new Parse.Query('Cookie');
  q1.equalTo('expires', undefined);
  query._orQuery([q,q1]);
  return query.find().then(function(results) {
    results.forEach(function(resObj) {
      result = result + resObj.get('name')+'='+resObj.get('value')+';';
    });
    return Parse.Promise.as(result);
  });
}

function cookiedHttpRequest(params){
  var hostname = getHostName(params.url);
  return getCookies(hostname).then(function(cookieStr){
    if (params.headers === undefined){
      params.headers = {};
    }
    params.headers.Cookie=cookieStr;
    var oldFollowRedirects = params.followRedirects;
    if (oldFollowRedirects &&(params.maxRedirect === undefined)){
      params.maxRedirect = 10;
    }
    params.followRedirects = false;
    return Parse.Cloud.httpRequest(params).then(
      function(httpResponse) {
        // success
        httpResponse.url = params.url;
        return saveCookies(httpResponse.cookies).then(function(){
          return Parse.Promise.as(httpResponse);
        });
      },function(httpResponse) {
        return saveCookies(httpResponse.cookies).then(function(){
          httpResponse.url = params.url;
          //Обработка редиректа
          if ( oldFollowRedirects && (
              (httpResponse.status == 301)||
              (httpResponse.status == 302)||
              (httpResponse.status == 303)||
              (httpResponse.status == 307)) &&
            (!!httpResponse.headers.Location) &&
            (params.maxRedirect>0)
          ){
            params.maxRedirect = params.maxRedirect - 1;
            params.followRedirects = true;
            params.url = httpResponse.headers.Location;
            if (params.headers === undefined){
              params.headers = {};
            }
            params.headers.Referer = httpResponse.url;
            if (httpResponse.status === 303){
              if (params.method != 'HEAD') {
                params.method='GET';
              }
            }
            return cookiedHttpRequest(params);
          } else {
            return Parse.Promise.error(httpResponse);
          }
        });
      }
    );
  });
}

//handlers

app.get('/testlog', function(req, res) {
  console.log('yes');
  res.send('try log');
});

app.get('/param', function(req, res) {
  res.json(req.query);
});

app.get('/needle', function(req, res) {
  res.send(typeof needle.get);
});

app.get('/load', function(req, res) {
  request({url:'http://g.e-hentai.org/home.php'}, 
  function (error, response, body) {
      if (!error && response.statusCode == 200) {
          res.send(htmlspecialchars(response.body));
      } else {
          res.send('Request '+ response.url +' failed with response code ' + response.statusCode );  
      }
  });
});

function parseEx(page){
  var results = [];
  var result;
  var rows = page.split('<tr class="gtr');
  for (var i = 1; i < rows.length; i++) {
    var cols = rows[i].split('<td');
    result = {};
    result.type = safeGet(cols[1].match(/alt="(\w+)"/),1); 
    result.date = safeGet(cols[2].match(/>([\d- :]+)<\//),1); 
    result.uploader = safeGet(cols[4].match(/uploader\/([^"]+)"/),1); 
    var cols2 = cols[3].split('<div class=');
    result.image = 'http://exhentai.org/'+safeGet(cols2[1].match(/(t\/[^\.]+\.jpg)/),1); 
    if (cols2[3].substr(0,5) === '"it5"') {
      result.url = safeGet(cols2[3].match(/href="(http:\/\/exhentai.org\/g\/[\d\w\/]+)"/),1); 
      result.title = safeGet(cols2[3].match(/>([^<]+)<\//),1); 
    } else {
      result.url = safeGet(cols2[4].match(/href="(http:\/\/exhentai.org\/g\/[\d\w\/]+)"/),1); 
      result.title = safeGet(cols2[4].match(/>([^<]+)<\//),1); 
      result.tagtext = '<div class=' + cols2[3];
    }
    //result.raw = cols;
    //result.raw2=cols2;
    results.push(result);
  }
  return results;
}

function exhentaiToRss(html){
  var rows = parseEx(html);
  var feed = new rss({
      title: safeGet(html.match(/<title>([^<]+)<\/title>/),1),
  });       
  rows.forEach(function(row){
    feed.item({
        title: row.title,
        description: '<img src="*'+row.image+'" align="left"/> <p>'+row.type+'</p>',
        url: row.url,
        categories: [row.type],
        author: row.uploader, // optional - defaults to feed author property
        date: row.date, // any format that js Date can parse.
        //enclosure: {url:'...', file:'path-to-file'}, // optional enclosure
    });    
  });
  return feed;
}

app.get('/parse2', function(req, res) {
  cookiedHttpRequest({
    url: 'http://exhentai.org/',
    followRedirects: true
  }).then(function(httpResponse) {
    res.send(exhentaiToRss(httpResponse.text).xml());
  },function(httpResponse) {
    res.send('Request '+ httpResponse.url +' failed with response code ' + httpResponse.status);
  });
});

app.get('/parse', function(req, res) {
  cookiedHttpRequest({
    url: 'http://exhentai.org/',
    followRedirects: true
  }).then(function(httpResponse) {
    res.send('<pre>'+htmlspecialchars(
      JSON.stringify(parseEx(httpResponse.text)).replace(/,/g,',\n')
    )+'</pre>');
  },function(httpResponse) {
    res.send('Request '+ httpResponse.url +' failed with response code ' + httpResponse.status);
  });
});

app.get('/test', function(req, res) {
  request({url:'http://g.e-hentai.org/home.php'}, 
  function (error, httpResponse, body) {
      if (!error && httpResponse.statusCode == 200) {
    // success
    //load form fields
    var inputList = httpResponse.body.match( /<input [^>]+>/ig );
    var fieldsList = {};
    for (var i=0; i<inputList.length; i++) {
      var name=inputList[i].match(/name="(\w+)"/);
      if (name !== null) {
        var value=inputList[i].match(/value="([^"]+)"/);
        if (value === null) {
          fieldsList[name[1]]="";
        } else {
          fieldsList[name[1]]=value[1];
        }
      }
    }
    console.log(typeof request.jar());
    res.send(htmlspecialchars(httpResponse.body)+'<pre>'+
    JSON.stringify(httpResponse.headers).replace(/,/g,',\n') +'\n'+
      JSON.stringify(fieldsList).replace(/,/g,',\n')+
      '\n\n'+
      JSON.stringify(request.jar()).replace(/,/g,',\n')+
//      '\n'+ httpResponse.cookies.toString() +
      '</pre>'
    );
      } else {
          //res.send('Request '+ httpResponse.url +' failed with response code ' + httpResponse.statusCode );  
	  res.json(httpResponse.headers);
      }
  });
});

app.get('/test_login', function(req, res) {
  request({url:'http://g.e-hentai.org/home.php'}, 
  function (error, httpResponse, body) {
      if (!error && httpResponse.statusCode == 200) {
    // success
    if (!!(~httpResponse.body.indexOf("act=Login"))) {
    //load form fields
    var inputList = httpResponse.body.match( /<input [^>]+>/ig );
    var fieldsList = {};
    for (var i=0; i<inputList.length; i++) {
      var name=inputList[i].match(/name="(\w+)"/);
      if (name !== null) {
        var value=inputList[i].match(/value="([^"]+)"/);
        if (value === null) {
          fieldsList[name[1]]="";
        } else {
          fieldsList[name[1]]=value[1];
        }
      }
    }
      //Set login and password
      fieldsList.UserName='tumanchik';
      fieldsList.PassWord='123asd';

      request({
        method: 'POST',
        url: 'https://forums.e-hentai.org/index.php?act=Login&CODE=01',
        followRedirects: true,
        form: fieldsList
      },function (error, httpResponse, body) {
      if (!error && httpResponse.statusCode == 200) {
        res.send(htmlspecialchars(httpResponse.body)+'<pre>'+
          JSON.stringify(httpResponse.headers).replace(/,/g,',\n') +
          '\n\n'+
          JSON.stringify(fieldsList).replace(/,/g,',\n')+
          '\n\n'+
          JSON.stringify(request.cookies._jar ).replace(/,/g,',\n')+
          '</pre>');
      }else {
        // error
        console.log(JSON.stringify(error));
        res.send('Request '+' failed');// with response code ' + httpResponse.status + ' ' + httpResponse.headers.toJSON());
      }
      });
    }else {
        res.send(htmlspecialchars(httpResponse.body)+'<pre>'+
          JSON.stringify(httpResponse.headers).replace(/,/g,',\n') +
          '</pre>');
    }//end if
      } else {
          //res.send('Request '+ httpResponse.url +' failed with response code ' + httpResponse.statusCode );  
	  //res.json(httpResponse.headers);
	  res.send('Request '+' failed');
      }
  });
});

app.get('/jar', function(req, res) {
  res.send('<pre>'+
    JSON.stringify(request.cookies ).replace(/,/g,',\n')+
    JSON.stringify(request.cookies.getCookies('https://forums.e-hentai.org/') ).replace(/,/g,',\n')+
    JSON.stringify(request.cookies._jar).replace(/,/g,',\n')+
    request.cookies.getCookieString('https://forums.e-hentai.org/') +
    '</pre>'
  );  
});


app.get('/testx', function(req, res) {
  cookiedHttpRequest({
    url: 'http://g.e-hentai.org/home.php',
    followRedirects: true
  }).then(function(httpResponse) {
    // success
    
  },function(httpResponse) {
    // error
    res.send('Request failed with response code ' + httpResponse.status + ' ' + httpResponse.headers);
    //res.json(httpResponse.headers);
  });

});

app.get('/testz', function(req, res) {
  cookiedHttpRequest({
    url: 'http://g.e-hentai.org/home.php',
    followRedirects: true
  }).then(function(httpResponse){
    if (!!(~httpResponse.text.indexOf("act=Login"))) {
      //load form fields
      var inputList = httpResponse.text.match( /<input [^>]+>/ig );
      var fieldsList = {};
      for (var i=0; i<inputList.length; i++) {
        var name=inputList[i].match(/name="(\w+)"/);
        if (name !== null) {
          var value=inputList[i].match(/value="([^"]+)"/);
          if (value === null) {
            fieldsList[name[1]]="";
          } else {
            fieldsList[name[1]]=value[1];
          }
        }
      }
      //Set login and password
      fieldsList.UserName='tumanchik';
      fieldsList.PassWord='123asd';

      cookiedHttpRequest({
        method: 'POST',
        url: 'https://forums.e-hentai.org/index.php?act=Login&CODE=01',
        followRedirects: true,
        body: fieldsList
      }).then(function(httpResponse){
        res.send(htmlspecialchars(httpResponse.text)+'<pre>'+
          JSON.stringify(httpResponse.headers).replace(/,/g,',\n') +
          '\n\n'+
          JSON.stringify(fieldsList).replace(/,/g,',\n')+
          '\n\n'+
          JSON.stringify(httpResponse.cookies).replace(/,/g,',\n')+
          '</pre>');
      },function(httpResponse) {
        // error
        res.send('Request '+httpResponse.url+' failed with response code ' + httpResponse.status + ' ' + httpResponse.headers.toJSON());
      });
    }else {
        res.send(htmlspecialchars(httpResponse.text)+'<pre>'+
          JSON.stringify(httpResponse.headers).replace(/,/g,',\n') +
          '</pre>');
    }//end if
  },function(httpResponse) {
    // error
    res.send('Request '+httpResponse.url+' failed with response code ' + httpResponse.status + ' ' + httpResponse.headers.toJSON());
  });
});

app.get('/delc', function(req, res) {
  var query = new Parse.Query("Cookie");
  query.lessThan("expires", new Date());
  query.find().then(function(results) {
    if (results.length===0){
      res.send('No cookies expired.');
      return;
    }
    // Collect one promise for each delete into an array.
    var promises = [];
    results.forEach(function(result) {
      // Start this delete immediately and add its promise to the list.
      promises.push(result.destroy());
    });
    // Return a new promise that is resolved when all of the deletes are finished.
    return Parse.Promise.when(promises);
  }).then(function() {
    // Expired cookies was deleted.
    res.send('Expired cookies was deleted.');
  }, function(error) {
    res.send("Error: " + error.code + " " + error.message);
  });
});

app.get('/getcs', function(req, res) {
  var domain = 'forums.e-hentai.org';
  getCookies(domain).then(function(cookieStr) {
    res.send(cookieStr);
  }, function(error) {
    res.send("Error: " + error.code + " " + error.message);
  });
});

app.get('/trss', function(req, res) {
  var feed = new rss({
    title: 'title',
    description: 'description',
    feed_url: 'http://example.com/rss.xml',
    site_url: 'http://example.com',
    image_url: 'http://example.com/icon.png',
    docs: 'http://example.com/rss/docs.html',
    managingEditor: 'Dylan Greene',
    webMaster: 'Dylan Greene',
    copyright: '2013 Dylan Greene',
    language: 'en',
    categories: ['Category 1','Category 2','Category 3'],
    pubDate: 'May 20, 2012 04:00:00 GMT',
    ttl: '60',
});       
/* loop over data and add to feed */   
feed.item({
    title:  'item title',
    description: 'use this for the content. It can include html.',
    url: 'http://example.com/article4?this&that', // link to the item
    guid: '1123', // optional - defaults to url
    categories: ['Category 1','Category 2','Category 3','Category 4'], // optional - array of item categories
    author: 'Guest Author', // optional - defaults to feed author property
    date: 'May 27, 2012', // any format that js Date can parse.
    enclosure: {url:'...', file:'path-to-file'}, // optional enclosure
});     

     res.send('<pre>'+htmlspecialchars(feed.xml())+'</pre>');
     //res.send('create object');
});

// // Example reading from the request body of an HTTP post request.
// app.post('/test', function(req, res) {
//   // POST http://example.parseapp.com/test (with request body "message=hello")
//   res.send(req.body.message);
// });

// Attach the Express app to Cloud Code.
app.listen(8081);