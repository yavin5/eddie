let stringResponse='```python\n'
+ 'webSearch({"searchQuery": "current Ethereum price"})\n'
+ '```';

if (/python/gm.test(stringResponse)
   && (/web.*?[\r\n\s]*?.*search[\s]*\(/gmi.test(stringResponse)
    || /search.*?[\r\n\s]*?.*web[\s]*\(/gmi.test(stringResponse))) {
            console.log('webSearch python implementation.');
} else {
  console.log('no match!');
}
console.log("done.");
