let output     = "";
let prettydiff = require("prettydiff");
let options    = prettydiff.options;
options.source = "my code";
options.diff   = "my ode";
options.output = 'a.htm';
options.mode = 'diff';
output         = prettydiff();
console.log(output)