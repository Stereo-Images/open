// Current g29 entry point. Original development script is archived in source/historical-scripts.
process.chdir(__dirname);
require('./verify-g29.cjs');
require('./verify-batch.cjs');
