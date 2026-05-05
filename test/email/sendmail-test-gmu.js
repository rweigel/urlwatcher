const sendmail = require('sendmail')({'silent': true})
 
sendmail({
    from: 'ubuntu@hapi-server.org',
    to: 'rweigel@gmu.edu',
    subject: 'Test sendmail',
    html: 'Body of email ',
  }, function(err, reply) {
  	if (err) {
	    console.log('error:');
	    console.log(err);
	    console.log(err.stack);  			    
  	} else {
	    console.log('Reply:')
	    console.dir(reply);
	}
});
