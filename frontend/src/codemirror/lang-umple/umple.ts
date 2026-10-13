/**
 * CodeMirror language definition for Umple.
 * Wraps the generated Lezer parser with syntax highlighting tags. createEditorExtensions enables it on every editor.
 */

import { parser } from "./parser.js"
import { LRLanguage, indentNodeProp, continuedIndent, foldNodeProp, foldInside, LanguageSupport } from "@codemirror/language"
import { styleTags, tags as t } from "@lezer/highlight"

const parserWithMetadata = parser.configure({
  props: [
    styleTags({
      identifier: t.name,
      InlineComment: t.lineComment,
      MultilineComment: t.blockComment,
      name: t.docComment,
      Integer: t.integer,
      MultiplicityInteger: t.literal,
      Asterisk: t.literal,
      Arrow: t.literal,
      DoubleDots: t.literal,
      Name: t.keyword,
      InterfaceDefinitionName: t.keyword,
      MethodName: t.color,
      NestedType: t.bool,
      InlineStateMachineName: t.keyword,
      FromState: t.typeName,
      ToState: t.heading1,
      StateNameDestination: t.heading1,
      EventName: t.heading,
      StateName: t.keyword,
      StringLiteral: t.string,
      NameOfTypedName: t.keyword,
      ClassName: t.typeName,
      BaseType: t.typeName,
      ExtendsName: t.typeName,
      AssociationEndName: t.keyword,
      SimpleAttributeName: t.bool,

      "class queued pooled immutable equals unspecified afterEvery after public static void unique lazy ivar association singleton isA do opt not and or xor XOR implementsReq req mixset namespace --redefine use abstract depend interface internal constant const trait associationClass statemachine entry exit return": t.definitionKeyword,
      "generate Java Nothing Php RTCpp SimpleCpp Ruby Python Cpp Json StructureDiagram Yuml Violet Umlet Simulate TextUml Scxml GvStateDiagram GvClassDiagram GvFeatureDiagram GvClassTraitDiagram GvEntityRelationshipDiagram Alloy NuSMV NuSMVOptimizer Papyrus Ecore Xmi Xtext Sql Umple UmpleSelf USE Test SimpleMetrics PlainRequirementsDoc Uigu2 -s --suboption": t.definitionKeyword,
      "module package import": t.moduleKeyword,

      ["requires exports opens uses provides public private protected static transitive abstract final " +
        "strictfp synchronized native transient volatile throws"]: t.modifier,
      IntegerLiteral: t.integer,
      FloatingPointLiteral: t.float,
    }),
    indentNodeProp.add({
      MethodBody: continuedIndent(),
    }),
    foldNodeProp.add({
      "ClassBody": foldInside,
      "InterfaceDefinitionBody": foldInside,
      "InlineStateMachineBody": foldInside,
      "MethodBody": foldInside,
    })
  ]
})

export const umpleLanguage = LRLanguage.define({
  parser: parserWithMetadata,
  languageData: {
    closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] },
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    indentOnInput: /^\s*(?:case |default:|\{|\})$/,
  }
})

export function umple() {
  return new LanguageSupport(umpleLanguage)
}
