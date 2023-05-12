
/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

parser grammar esql_parser;

options {tokenVocab=esql_lexer;}

singleStatement
    : query EOF
    ;

query
    : sourceCommand                 #singleCommandQuery
    | query PIPE processingCommand  #compositeQuery
    ;

sourceCommand
    : explainCommand
    | fromCommand
    | rowCommand
    | showCommand
    ;

processingCommand
    : evalCommand
    | limitCommand
    | projectCommand
    | renameCommand
    | dropCommand
    | dissectCommand
    | grokCommand
    | sortCommand
    | statsCommand
    | whereCommand
    ;

whereCommand
    : WHERE whereBooleanExpression
    ;

whereBooleanExpression
    : NOT booleanExpression
    | valueExpression
    | regexBooleanExpression
    | left=booleanExpression operator=AND right=booleanExpression
    | left=booleanExpression operator=OR right=booleanExpression
    | WHERE_FUNCTIONS LP qualifiedName ((COMMA functionExpressionArgument)*)? RP
    ;

booleanExpression
    : NOT booleanExpression
    | valueExpression
    | left=booleanExpression operator=AND right=booleanExpression
    | left=booleanExpression operator=OR right=booleanExpression
    ;

regexBooleanExpression
    : valueExpression (NOT)? kind=LIKE pattern=string
    | valueExpression (NOT)? kind=RLIKE pattern=string
    ;

valueExpression
    : operatorExpression
    | comparison
    ;

comparison
    : left=operatorExpression comparisonOperator right=operatorExpression
    ;

mathFn
    : functionIdentifier LP (functionExpressionArgument (COMMA functionExpressionArgument)*)? RP
    ;

mathEvalFn
    : mathFunctionIdentifier LP (mathFunctionExpressionArgument (COMMA mathFunctionExpressionArgument)*)? RP
    ;

operatorExpression
    : primaryExpression
    | mathFn
    | mathEvalFn
    | operator=(MINUS | PLUS) operatorExpression
    | left=operatorExpression operator=(ASTERISK | SLASH | PERCENT) right=operatorExpression
    | left=operatorExpression operator=(PLUS | MINUS) right=operatorExpression
    ;

primaryExpression
    : constant
    | qualifiedName
    | LP booleanExpression RP
    | identifier LP (booleanExpression (COMMA booleanExpression)*)? RP
    ;

rowCommand
    : ROW fields
    ;

fields
    : field (COMMA field)*
    ;

field
    : booleanExpression
    | userVariable ASSIGN booleanExpression
    ;

userVariable
   :  identifier
   ;

fromCommand
    : FROM sourceIdentifier (COMMA sourceIdentifier)*
    ;

evalCommand
    : EVAL fields
    ;

statsCommand
    : STATS fields? (BY qualifiedNames)?
    ;

sourceIdentifier
    : SRC_UNQUOTED_IDENTIFIER
    | SRC_QUOTED_IDENTIFIER
    ;

functionExpressionArgument
   : qualifiedName
   | string
   ;

mathFunctionExpressionArgument
   : qualifiedName
   | string
   | number
   | operatorExpression
   | number (DATE_LITERAL)
   | comparison
   ;

qualifiedName
    : identifier (DOT identifier)*
    ;

qualifiedNames
    : qualifiedName (COMMA qualifiedName)*
    ;

identifier
    : UNQUOTED_IDENTIFIER
    | QUOTED_IDENTIFIER
    ;

mathFunctionIdentifier
    : MATH_FUNCTION
    ;

functionIdentifier
    : UNARY_FUNCTION
    ;

constant
    : NULL
    | numericValue
    | booleanValue
    | string
    | OPENING_BRACKET numericValue (COMMA numericValue)* CLOSING_BRACKET
    | OPENING_BRACKET booleanValue (COMMA booleanValue)* CLOSING_BRACKET
    | OPENING_BRACKET string (COMMA string)* CLOSING_BRACKET
    ;

numericValue
    : decimalValue
    | integerValue
    ;

limitCommand
    : LIMIT INTEGER_LITERAL
    ;

sortCommand
    : SORT orderExpression (COMMA orderExpression)*
    ;

orderExpression
    : booleanExpression (ORDERING)? (NULLS_ORDERING (NULLS_ORDERING_DIRECTION))?
    ;

projectCommand
    :  PROJECT qualifiedNames
    ;

dropCommand
    :  DROP qualifiedNames
    ;

renameVariable
   :  identifier
   ;

renameCommand
    : RENAME renameClause (COMMA renameClause)*
    ;

renameClause
    : renameVariable ASSIGN qualifiedName
    ;

dissectCommand
    : DISSECT qualifiedNames string commandOptions?
    ;

grokCommand
    : GROK qualifiedNames string
    ;

commandOptions
    : commandOption (COMMA commandOption)*
    ;

commandOption
    : identifier ASSIGN constant
    ;

booleanValue
    : BOOLEAN_VALUE
    ;

number
    : DECIMAL_LITERAL  #decimalLiteral
    | INTEGER_LITERAL  #integerLiteral
    ;

decimalValue
    : DECIMAL_LITERAL
    ;

integerValue
    : INTEGER_LITERAL
    ;

string
    : STRING
    ;

comparisonOperator
    : COMPARISON_OPERATOR
    ;

explainCommand
    : EXPLAIN subqueryExpression
    ;

subqueryExpression
    : OPENING_BRACKET query CLOSING_BRACKET
    ;

showCommand
    : SHOW INFO
    | SHOW FUNCTIONS
    ;
