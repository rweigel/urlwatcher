const sendmail = require('sendmail')({devHost: 'localhost', devPort: 25})
 
sendmail({
    from: 'ubuntu@localhost',
    to: 'ubuntu@localhost',
    subject: 'Test sendmail',
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
