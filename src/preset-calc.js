// SPDX-License-Identifier: GPL-3.0-only
// Adapted from RisuBard src/ts/process/infunctions.ts at e5412a4878ae3a0073ffce8e06aed8f288dd9c53.
// Same RPN operators/precedence and numeric coercion, with local variables and bounded input.
// Never executes JavaScript or accesses host chat variables.
import { assert } from './core.js';

const precedence={'+':2,'-':2,'*':3,'/':3,'^':4,'%':3,'<':1,'>':1,'|':1,'&':1,'≤':1,'≥':1,'=':1,'≠':1,'!':5};
const isOperator=char=>Object.hasOwn(precedence,char);
const isNumber=token=>Boolean(parseFloat(token))||token==='0';

function toRPN(expression) {
  expression=expression.replace(/\s+/g,'');
  const tokens=[],output=[],stack=[];let pending='';
  for(let i=0;i<expression.length;i++) {
    const char=expression[i];
    if(char==='-'&&(i===0||isOperator(expression[i-1])||expression[i-1]==='('))pending+=char;
    else if(isOperator(char)){tokens.push(pending||'0',char);pending='';}
    else pending+=char;
  }
  tokens.push(pending||'0');
  for(const token of tokens) {
    if(isNumber(token))output.push(token);
    else if(isOperator(token)) {
      while(stack.length&&(token==='!'?precedence[token]<precedence[stack.at(-1)]:precedence[token]<=precedence[stack.at(-1)]))output.push(stack.pop());
      stack.push(token);
    }
  }
  while(stack.length)output.push(stack.pop());
  return output;
}
function calculate(tokens) {
  const stack=[];
  for(const token of tokens) {
    if(isNumber(token)){stack.push(parseFloat(token));continue;}
    const b=stack.pop(),a=stack.pop();
    switch(token) {
      case '+':stack.push(a+b);break;case '-':stack.push(a-b);break;
      case '*':stack.push(a*b);break;case '/':stack.push(a/b);break;
      case '^':stack.push(a**b);break;case '%':stack.push(a%b);break;
      case '<':stack.push(a<b?1:0);break;case '>':stack.push(a>b?1:0);break;
      case '≤':stack.push(a<=b?1:0);break;case '≥':stack.push(a>=b?1:0);break;
      case '=':stack.push(a===b?1:0);break;case '≠':stack.push(a!==b?1:0);break;
      case '|':stack.push(a||b);break;case '&':stack.push(a&&b);break;
      case '!':stack.push(b?0:1);break;
    }
  }
  return stack.length?stack.pop():0;
}
export function calculatePreset(source,{variables={},globals={}}={}) {
  assert(source.length<=65536,'CBS 계산식은 65,536자 이하만 지원합니다.');
  const read=(map,key)=>{const n=parseFloat(Object.hasOwn(map,key)?map[key]:'');return Number.isNaN(n)?'0':String(n);};
  const execute=text=>calculate(toRPN(text.replace(/\$([a-zA-Z0-9_]+)/g,(_,key)=>read(variables,key)).replace(/@([a-zA-Z0-9_]+)/g,(_,key)=>read(globals,key))
    .replace(/&&/g,'&').replace(/\|\|/g,'|').replace(/<=/g,'≤').replace(/>=/g,'≥').replace(/==/g,'=').replace(/!=/g,'≠').replace(/null/gi,'0')));
  const depth=[''];
  for(const char of source) {
    if(char==='('){assert(depth.length<50,'CBS 계산식 괄호 중첩이 너무 깊습니다.');depth.push('');}
    else if(char===')'&&depth.length>1){const value=execute(depth.pop());depth[depth.length-1]+=value;}
    else depth[depth.length-1]+=char;
  }
  return String(execute(depth.join('')));
}
