const sendmail = require('sendmail')()
 
sendmail({
    from: 'ubuntu@hapi-server.org',
    to: 'robert.s.weigel@gmail.com',
    subject: 'Test sendmail 2',
    html: 'Body of email ',
  }, function(err, reply) {
  	if (err) {
	    console.log('error:');
	    console.log(err);
	    console.log(err.stack);  			    
  	} else {
	    console.dir(reply);
	}
});
