// SPDX-License-Identifier: GPL-3.0-only
// Unmodified pure function bodies from RisuBard e5412a4878ae3a0073ffce8e06aed8f288dd9c53.
// src/ts/process/infunctions.ts; src/ts/parser/parser.svelte.ts.
// Only imports/context are replaced with the injected test values below. No host mutation.
export function nativeReference(variables:Record<string,string>={},globals:Record<string,string>={}) {
 const getChatVar=(key:string,..._args:unknown[])=>variables[key]??'null';
 const getGlobalChatVar=(key:string,..._args:unknown[])=>globals[key]??'null';

function toRPN(expression:string) {
    let outputQueue = '';
    let operatorStack = [];
    let operators = {
        '+': {precedence: 2, associativity: 'Left'},
        '-': {precedence: 2, associativity: 'Left'},
        '*': {precedence: 3, associativity: 'Left'},
        '/': {precedence: 3, associativity: 'Left'},
        '^': {precedence: 4, associativity: 'Left'},
        '%': {precedence: 3, associativity: 'Left'},
        '<': {precedence: 1, associativity: 'Left'},
        '>': {precedence: 1, associativity: 'Left'},
        '|': {precedence: 1, associativity: 'Left'},
        '&': {precedence: 1, associativity: 'Left'},
        '≤': {precedence: 1, associativity: 'Left'},
        '≥': {precedence: 1, associativity: 'Left'},
        '=': {precedence: 1, associativity: 'Left'},
        '≠': {precedence: 1, associativity: 'Left'},
        '!': {precedence: 5, associativity: 'Right'},
    };
    const operatorsKeys = Object.keys(operators);

    expression = expression.replace(/\s+/g, '');
    let expression2 = []

    let lastToken = ''

    for(let i = 0; i < expression.length; i++) {
        const char = expression[i]
        if (char === '-' && (i === 0 || operatorsKeys.includes(expression[i - 1]) || expression[i - 1] === '(')) {
            lastToken += char
        }
        else if (operatorsKeys.includes(char)) {
            if(lastToken !== '') {
                expression2.push(lastToken)
            }
            else{
                expression2.push('0')
            }
            lastToken = ''
            expression2.push(char)
        }
        else{
            lastToken += char
        }
    }

    if(lastToken !== '') {
        expression2.push(lastToken)
    }
    else{
        expression2.push('0')
    }

    expression2.forEach(token => {
        if (parseFloat(token) || token === '0') {
            outputQueue += token + ' ';
        } else if (operatorsKeys.includes(token)) {
            while (operatorStack.length > 0 &&
            ((operators[token].associativity === 'Left' &&
            operators[token].precedence <= operators[operatorStack[operatorStack.length - 1]].precedence) ||
            (operators[token].associativity === 'Right' &&
            operators[token].precedence < operators[operatorStack[operatorStack.length - 1]].precedence))) {
                outputQueue += operatorStack.pop() + ' ';
            }

            operatorStack.push(token);
        }
    });

    while (operatorStack.length > 0) {
        outputQueue += operatorStack.pop() + ' ';
    }

    return outputQueue.trim();
}

function calculateRPN(expression:string) {
    let stack:number[] = [];

    expression.split(' ').forEach(token => {
        if (parseFloat(token) || token === '0') {
            stack.push(parseFloat(token));
        } else {
            let [b, a] = [stack.pop(), stack.pop()];
            switch (token) {
                case '+': stack.push(a + b); break;
                case '-': stack.push(a - b); break;
                case '*': stack.push(a * b); break;
                case '/': stack.push(a / b); break;
                case '^': stack.push(a ** b); break;
                case '%': stack.push(a % b); break;
                case '<': stack.push(a < b ? 1 : 0); break;
                case '>': stack.push(a > b ? 1 : 0); break;
                case '|': stack.push(a || b); break;
                case '&': stack.push(a && b); break;
                case '≤': stack.push(a <= b ? 1 : 0); break;
                case '≥': stack.push(a >= b ? 1 : 0); break;
                case '=': stack.push(a === b ? 1 : 0); break;
                case '≠': stack.push(a !== b ? 1 : 0); break;
                case '!': stack.push(b ? 0 : 1); break;
            }
        }
    });

    if(stack.length === 0){
        return 0
    }

    return stack.pop()
}

function executeRPNCalculation(text:string) {
    text = text.replace(/\$([a-zA-Z0-9_]+)/g, (_, p1) => {
        const v = getChatVar(p1)
        const parsed = parseFloat(v)
        if(isNaN(parsed)){
            return "0"
        }
        return parsed.toString()
    }).replace(/\@([a-zA-Z0-9_]+)/g, (_, p1) => {
        const v = getGlobalChatVar(p1)
        const parsed = parseFloat(v)
        if(isNaN(parsed)){
            return "0"
        }
        return parsed.toString()
    })
    .replace(/&&/g, '&')
    .replace(/\|\|/g, '|')
    .replace(/<=/g, '≤')
    .replace(/>=/g, '≥')
    .replace(/==/g, '=')
    .replace(/!=/g, '≠')
    .replace(/null/gi, '0')
    const expression = toRPN(text);
    const evaluated = calculateRPN(expression);
    return evaluated
}

function calcString(text:string) {
    let depthText:string[] = ['']

    for(let i = 0; i < text.length; i++) {
        if(text[i] === '(') {
            depthText.push('')
        }
        else if(text[i] === ')' && depthText.length > 1) {
            let result = executeRPNCalculation(depthText.pop())
            depthText[depthText.length - 1] += result
        }
        else {
            depthText[depthText.length - 1] += text[i]
        }
    }

    return executeRPNCalculation(depthText.join(''))
}

function blockStartMatcher(p1:string,matcherArg:matcherArg):{type:blockMatch,type2?:string,funcArg?:string[],mode?:string}{
    const getScopedGlobalChatVar = (key: string) => (
        matcherArg.globalChatVariables && Object.hasOwn(matcherArg.globalChatVariables, key)
            ? matcherArg.globalChatVariables[key]
            : getGlobalChatVar(key, matcherArg.chat)
    )
    if(p1.startsWith('#if') || p1.startsWith('#if_pure ')){
        const statement = p1.split(' ', 2)
        const state = statement[1]
        if(state === 'true' || state === '1'){
            return {
                type:   p1.startsWith('#if_pure') ? 'ifpure' :
                        'parse'
            }
        }
        return {type:'ignore'}
    }

    if(p1.startsWith('#when')){
        if(p1.startsWith('#when ')){
            const statement = p1.split(' ', 2)
            const state = statement[1]
            return {type: (state === 'true' || state === '1') ? 'newif' : 'newif-falsy'}
        }
        else if(p1.startsWith('#when::')){
            const statement = p1.split('::').slice(1)
            if(statement.length === 1){
                const state = statement[0]
                return {type: (state === 'true' || state === '1') ? 'newif' : 'newif-falsy'}
            }
            let mode: 'normal' | 'keep' | 'legacy' = 'normal'

            const isTruthy = (s:string) => {
                return s === 'true' || s === '1'
            }
            while(statement.length > 1){
                const condition = statement.pop()
                const operator = statement.pop()
                switch(operator){
                    case 'not':{
                        if(isTruthy(condition)){
                            statement.push('0')
                        }
                        else{
                            statement.push('1')
                        }
                        break
                    }
                    case 'keep':{
                        mode = 'keep'
                        statement.push(condition)
                        break
                    }
                    case 'legacy':{
                        mode = 'legacy'
                        statement.push(condition)
                        break
                    }
                    case 'and':{
                        const condition2 = statement.pop()
                        if(isTruthy(condition) && isTruthy(condition2)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'or':{
                        const condition2 = statement.pop()
                        if(isTruthy(condition) || isTruthy(condition2)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'is':{
                        const condition2 = statement.pop()
                        if(condition === condition2){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'isnot':{
                        const condition2 = statement.pop()
                        if(condition !== condition2){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'var':{
                        const variable = getChatVar(condition, matcherArg.chat && typeof matcherArg.chara === 'object' ? matcherArg.chara : undefined, matcherArg.chat)
                        if(isTruthy(variable)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'toggle':{
                        const variable = getScopedGlobalChatVar('toggle_' + condition)
                        if(isTruthy(variable)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'vis':{ //vis = variable is
                        const variable = getChatVar(statement.pop(), matcherArg.chat && typeof matcherArg.chara === 'object' ? matcherArg.chara : undefined, matcherArg.chat)
                        if(variable === condition){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'visnot':{ //visnot = variable is not
                        const variable = getChatVar(statement.pop(), matcherArg.chat && typeof matcherArg.chara === 'object' ? matcherArg.chara : undefined, matcherArg.chat)
                        if(variable !== condition){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'tis':{ //tis = toggle is
                        const variable = getScopedGlobalChatVar('toggle_' + statement.pop())
                        if(variable === condition){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case 'tisnot':{ //tisnot = toggle is not
                        const variable = getScopedGlobalChatVar('toggle_' + statement.pop())
                        if(variable !== condition){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case '>':{
                        const condition2 = statement.pop()
                        if(parseFloat(condition2) > parseFloat(condition)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case '<':{
                        const condition2 = statement.pop()
                        if(parseFloat(condition2) < parseFloat(condition)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case '>=':{
                        const condition2 = statement.pop()
                        if(parseFloat(condition2) >= parseFloat(condition)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    case '<=':{
                        const condition2 = statement.pop()
                        if(parseFloat(condition2) <= parseFloat(condition)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                    default:{
                        if(isTruthy(condition)){
                            statement.push('1')
                        }
                        else{
                            statement.push('0')
                        }
                        break
                    }
                }
            }

            const finalCondition = statement[0]
            if(isTruthy(finalCondition)){
                switch(mode){
                    case 'keep':{
                        return {type: 'newif', type2: 'keep'}
                    }
                    case 'legacy':{
                        return {type: 'parse'}
                    }
                    default:{
                        return {type: 'newif'}
                    }
                }
            }
            else{
                switch(mode){
                    case 'keep':{
                        return {type: 'newif-falsy', type2: 'keep'}
                    }
                    case 'legacy':{
                        return {type: 'ignore'}
                    }
                    default:{
                        return {type: 'newif-falsy'}
                    }
                }
            }
        }
        else{
            return {type: 'newif-falsy'}
        }
    }
    if(p1 === '#pure'){
        return {type:'pure'}
    }
    if(p1 === '#pure_display' || p1 === '#puredisplay'){
        return {type:'pure-display'}
    }
    if(p1 === '#code'){
        return {type:'normalize'}
    }
    if(p1.startsWith('#escape')){
        const t2 = p1.substring(7).trim()
        const mode = t2 === '::keep' ? 'keep' : undefined
        return {type:'escape', mode}
    }
    if(p1.startsWith('#each')){
        let t2 = p1.substring(5).trim()
        let mode: string | undefined
        if(t2.startsWith('::keep ')){
            mode = 'keep'
            t2 = t2.substring(7).trim()
        }
        if(t2.startsWith('as ')){
            t2 = t2.substring(3).trim()
        }
        return {type:'each', type2:t2, mode}
    }
    if(p1.startsWith('#func')){
        const statement = p1.split(' ')
        if(statement.length > 1){
            return {type:'function',funcArg:statement.slice(1)}
        }

    }

    return {type:'nothing'}
}

function trimLines(p1:string){
    return p1.split('\n').map((v) => {
        return v.trimStart()
    }).join('\n').trim()
}

function blockEndMatcher(p1:string,type:{type:blockMatch,type2?:string,mode?:string},matcherArg:matcherArg):string{
    const p1Trimmed = p1.trim()
    switch(type.type){
        case 'pure':
        case 'pure-display':
        case 'function':{
            return p1Trimmed
        }
        case 'parse':{
            return trimLines(p1Trimmed)
        }
        case 'each':{
            if(type.mode === 'keep'){
                return p1
            }
            return trimLines(p1Trimmed)
        }
        case 'ifpure':{
            return p1
        }
        case 'newif':
        case 'newif-falsy':{
            const lines =  p1.split("\n")

            if(lines.length === 1){
                const elseIndex = p1.indexOf('{{:else}}')
                if(elseIndex !== -1){
                    if(type.type === 'newif'){
                        return p1.substring(0, elseIndex)
                    }
                    if(type.type === 'newif-falsy'){
                        return p1.substring(elseIndex + 9)
                    }
                }
                else{
                    if(type.type === 'newif'){
                        return p1
                    }
                    if(type.type === 'newif-falsy'){
                        return ''
                    }
                }
            }

            const elseLine = lines.findIndex((v) => {
                return v.trim() === '{{:else}}'
            })

            if(elseLine !== -1 && type.type === 'newif'){
                lines.splice(elseLine) //else line and everything after it is removed
            }
            if(elseLine !== -1 && type.type === 'newif-falsy'){
                lines.splice(0, elseLine + 1) //everything before else line is removed
            }
            if(elseLine === -1 && type.type === 'newif-falsy'){
                return ''
            }

            if(type.type2 !== 'keep'){
                while(lines.length > 0 && lines[0].trim() === ''){
                    lines.shift()
                }
                while(lines.length > 0 && lines[lines.length - 1].trim() === ''){
                    lines.pop()
                }
            }
            return lines.join('\n')
        }

        case 'normalize':{
            return p1Trimmed.trim().replaceAll('\n','').replaceAll('\t','')
            .replaceAll(/\\u([0-9A-Fa-f]{4})/g, (match, p1) => {
                return String.fromCharCode(parseInt(p1, 16))
            })
            .replaceAll(/\\(.)/g, (match, p1) => {
                switch(p1){
                    case 'n':
                        return '\n'
                    case 'r':
                        return '\r'
                    case 't':
                        return '\t'
                    case 'b':
                        return '\b'
                    case 'f':
                        return '\f'
                    case 'v':
                        return '\v'
                    case 'a':
                        return '\a'
                    case 'x':
                        return '\x00'
                    default:
                        return p1
                }
            })
        }
        case 'escape':{
            return risuEscape(type.mode === 'keep' ? p1 : p1Trimmed)
        }
        default:{
            return ''
        }
    }
}


 return {calcString,blockStartMatcher,blockEndMatcher};
}
