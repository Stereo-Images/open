const {harness} = require('./test-harness.cjs');
const extract = html => html.slice(html.indexOf('// --- START OF SCRIPT ---'), html.indexOf('// --- END OF SCRIPT ---') + '// --- END OF SCRIPT ---'.length);
module.exports = {harness, extract};
