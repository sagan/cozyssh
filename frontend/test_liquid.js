import { Liquid } from 'liquidjs';

const engine = new Liquid();
const templateStr = 'Hello {{ name }}! {{ vars.foo }} {{ localVars.bar }} {{ shellIntegration.cwd }} {% assign x = 10 %} {% for y in items %} {{ x }} {{ y }} {% endfor %}';
const parsed = engine.parse(templateStr);
const allVars = engine.variablesSync(parsed);
console.log('All variables:', allVars);

const internalVars = new Set();
const assignRegex = /{%\s*assign\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
const captureRegex = /{%\s*capture\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
const forRegex = /{%\s*for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in/g;
const tablerowRegex = /{%\s*tablerow\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in/g;

let match;
while ((match = assignRegex.exec(templateStr)) !== null) {
  internalVars.add(match[1]);
}
while ((match = captureRegex.exec(templateStr)) !== null) {
  internalVars.add(match[1]);
}
while ((match = forRegex.exec(templateStr)) !== null) {
  internalVars.add(match[1]);
}
while ((match = tablerowRegex.exec(templateStr)) !== null) {
  internalVars.add(match[1]);
}

console.log('Internal variables:', Array.from(internalVars));

const excluded = new Set(['vars', 'localVars', 'shellIntegration']);
const userVars = allVars.filter(v => !excluded.has(v) && !internalVars.has(v));
console.log('User variables:', userVars);

const context = {
  name: 'World',
  vars: { foo: 'bar_value' },
  localVars: { bar: 'local_value' },
  shellIntegration: { cwd: '/home/user' },
  items: [1, 2, 3]
};
engine.parseAndRender(templateStr, context).then(res => {
  console.log('Rendered:', res);
});
