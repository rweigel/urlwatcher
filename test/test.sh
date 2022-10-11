echo "testing1234" > html/test.html

node urlwatcher.js -c test/app-config.json &

cd html/;
sleep 2;
rm test.html;
echo "test.sh: Removed test.html"
sleep 3;
echo "testing1234" > test.html
echo "test.sh: Recreated test.html"
sleep 2;
echo "testing1235" > test.html
echo "test.sh: Modified last character in test.html"
sleep 3;
rm test.html;

echo "test.sh: Killing server"
kill -9 $!
