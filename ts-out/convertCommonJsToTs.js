import fs from "fs-extra";
import * as path from "path";
import * as glob from "glob";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default;
import * as t from "@babel/types";
import { classTemplate, moduleTemplate, controllerTemplate, modelIndexTemplate, modelTemplate, } from "./codeTemplates.js";
import { methodConversionSystemMessage, methodRefineSystemMessage, importsConversionSystemMessage, importsConversionUserMessage, methodConversionUserMessage, methodRefineUserMessage, propertiesConversionSystemMessage, propertiesConversionUserMessage, } from "./prompts.js";
import { OpenAI } from "openai";
const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
class ConvertCommonJsToTs {
    constructor() {
        this.cjsCodeComponents = {
            imports: [],
            properties: [],
            methods: [],
            parentClass: null,
            shell: "",
        };
        this.tsCodeComponents = {
            imports: [],
            properties: [],
            methods: [],
            parentClass: null,
            shell: "",
        };
        this.allTypes = "";
        this.fullCjsFile = "";
        this.fullProjectFileTree = "";
        this.currentFileType = "";
    }
    async callLlm(systemMessage, userMessage) {
        console.log("Calling LLM");
        //console.log(`System message: ${systemMessage}`);
        //console.log(`User message: ${userMessage}`);
        //console.log("-----------------------------------------------------------");
        const completion = await openaiClient.chat.completions.create({
            model: "gpt-4-0125-preview",
            temperature: 0.0,
            max_tokens: 4095,
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: userMessage },
            ],
        });
        let llmOutput = completion.choices[0].message.content;
        if (llmOutput) {
            llmOutput = llmOutput.replace(/```json/g, "");
            llmOutput = llmOutput.replace(/```typescript/g, "");
            llmOutput = llmOutput.replace(/```javascript/g, "");
            llmOutput = llmOutput.replace(/```html/g, "");
            llmOutput = llmOutput.replace(/```markdown/g, "");
            llmOutput = llmOutput.replace(/```/g, "");
        }
        console.log(`LLM Output: ${llmOutput}`);
        return llmOutput || "";
    }
    parseSourceCodeComponents() {
        this.cjsCodeComponents = {
            imports: [],
            properties: [],
            methods: [],
            parentClass: null,
            shell: "",
        };
        const ast = parser.parse(this.fullCjsFile, {
            sourceType: "script",
            plugins: ["classProperties"],
        });
        traverse(ast, {
            ClassDeclaration: (path) => {
                if (path.node.superClass) {
                    const superClass = path.node.superClass;
                    // If superClass is an Identifier, which is a common case, get its name
                    if (t.isIdentifier(superClass)) {
                        this.cjsCodeComponents.parentClass = superClass.name;
                    }
                }
            },
            CallExpression: (path) => {
                if (t.isIdentifier(path.node.callee, { name: "require" })) {
                    // This node is a `require` call
                    const argument = path.node.arguments[0];
                    if (t.isStringLiteral(argument)) {
                        // The argument is a string literal, we capture the required module
                        const requiredModule = argument.value;
                        // Construct a representation similar to ImportDeclaration for consistency
                        const requireStatement = `var ${requiredModule} = require('${requiredModule}');`;
                        this.cjsCodeComponents.imports.push(requireStatement);
                    }
                }
            },
            ImportDeclaration: (path) => {
                const { start, end } = path.node;
                if (start !== null && end !== null) {
                    this.cjsCodeComponents.imports.push(this.fullCjsFile.slice(start, end));
                }
            },
            ClassProperty: (path) => {
                const { start, end } = path.node;
                if (start !== null && end !== null) {
                    this.cjsCodeComponents.properties.push(this.fullCjsFile.slice(start, end));
                }
            },
            ClassMethod: (path) => {
                const { start, end } = path.node;
                if (start !== null && end !== null) {
                    this.cjsCodeComponents.methods.push(this.fullCjsFile.slice(start, end));
                }
            },
            FunctionDeclaration: (path) => {
                const { start, end } = path.node;
                if (start !== null && end !== null) {
                    this.cjsCodeComponents.methods.push(this.fullCjsFile.slice(start, end));
                }
            },
            VariableDeclaration: (path) => {
                path.node.declarations.forEach((declaration) => {
                    if (t.isVariableDeclarator(declaration) &&
                        t.isIdentifier(declaration.id)) {
                        // Handle simple types directly
                        if (t.isStringLiteral(declaration.init) ||
                            t.isNumericLiteral(declaration.init)) {
                            this.cjsCodeComponents.properties.push(`${declaration.id.name}: ${declaration.init.value}`);
                        }
                        // Handle complex types like new Set()
                        else if (t.isNewExpression(declaration.init) &&
                            t.isIdentifier(declaration.init.callee)) {
                            if (declaration.init.callee.name === "Set") {
                                const args = declaration.init.arguments;
                                // Assuming the first argument to Set is an array (common use case)
                                if (args.length > 0 && t.isArrayExpression(args[0])) {
                                    const setItems = args[0].elements
                                        .map((element) => {
                                        if (t.isStringLiteral(element)) {
                                            return `'${element.value}'`;
                                        }
                                        else if (t.isNumericLiteral(element)) {
                                            return element.value;
                                        }
                                        else if (t.isTemplateLiteral(element) &&
                                            element.quasis.length === 1) {
                                            // For simplicity, handling simple template literals without expressions
                                            return `\`${element.quasis[0].value.raw}\``;
                                        }
                                        // Extend with more types as needed
                                        return "unknown"; // Placeholder for elements that are not directly serializable
                                    })
                                        .join(", ");
                                    this.cjsCodeComponents.properties.push(`${declaration.id.name}: new Set([${setItems}])`);
                                }
                                else {
                                    // Handle empty Set or unsupported initialization patterns
                                    this.cjsCodeComponents.properties.push(`${declaration.id.name}: new Set()`);
                                }
                            }
                        }
                    }
                });
            },
        });
    }
    async refineMethods() {
        const refinedMethods = [];
        for (const method of this.tsCodeComponents.methods) {
            // Use the template for refining methods, could be adjusted if different templates are needed
            const template = this.getTemplateForFileType(this.currentFileType);
            const systemMessage = methodRefineSystemMessage(template);
            // Constructing the user message for refining the method
            const userMessage = methodRefineUserMessage(this.allTypes, this.fullCjsFile, this.fullProjectFileTree, 
            // Assuming the fully converted file is a concatenation of all parts so far for context
            this.currentStateOfTheConversion, method // The specific TypeScript method to refine
            );
            // Call the LLM for refining each TypeScript method
            const refinedMethod = await this.callLlm(systemMessage, userMessage);
            refinedMethods.push(refinedMethod.trim());
        }
        // Update the tsCodeComponents.methods with the refined methods
        this.tsCodeComponents.methods = refinedMethods;
    }
    findAllCjsFiles(sourcePath) {
        return glob.sync(path.join(sourcePath, "**", "*.cjs"), {
            ignore: ["**/node_modules/**", "**/ts-out/**"],
        });
    }
    findAllTsFiles(sourcePath) {
        return glob.sync(path.join(sourcePath, "**", "*.ts"), {
            ignore: ["**/node_modules/**", "**/ts-out/**"],
        });
    }
    findAllTypeFiles(sourcePath) {
        return glob.sync(path.join(sourcePath, "**", "*.d.ts"), {
            ignore: ["**/node_modules/**", "**/ts-out/**"],
        });
    }
    getTemplateForFileType(fileType) {
        switch (fileType) {
            case "controller":
                return controllerTemplate;
            case "modelIndex":
                return modelIndexTemplate;
            case "model":
                return modelTemplate;
            case "class":
                return classTemplate;
            default:
                return moduleTemplate;
        }
    }
    async convertImports() {
        for (const singleImport of this.cjsCodeComponents.imports) {
            const template = this.getTemplateForFileType(this.currentFileType);
            const systemMessage = importsConversionSystemMessage(template);
            const userMessage = importsConversionUserMessage(this.allTypes, this.fullCjsFile, this.fullProjectFileTree, this.currentStateOfTheConversion, singleImport // Pass each import individually
            );
            // Call the LLM for each import
            const convertedImport = await this.callLlm(systemMessage, userMessage);
            this.tsCodeComponents.imports.push(convertedImport);
        }
    }
    async convertMethods() {
        for (const method of this.cjsCodeComponents.methods) {
            // Construct the template based on the current file type
            const template = this.getTemplateForFileType(this.currentFileType);
            // System message instructs the LLM on the conversion task
            const systemMessage = methodConversionSystemMessage(template);
            // User message provides the context and specifics for the conversion
            const userMessage = methodConversionUserMessage(this.allTypes, this.fullCjsFile, this.fullProjectFileTree, this.currentStateOfTheConversion, method // The specific method to convert
            );
            // Call the LLM for each method
            const convertedMethod = await this.callLlm(systemMessage, userMessage);
            this.tsCodeComponents.methods.push(convertedMethod);
        }
    }
    get currentStateOfTheConversion() {
        let tsCode = "";
        // Add imports
        tsCode += this.tsCodeComponents.imports.join("\n") + "\n\n";
        // Check if there is a parent class, indicating this might be a class-based structure
        if (this.tsCodeComponents.parentClass) {
            tsCode += `class ${this.tsCodeComponents.parentClass} {\n`;
            // Add properties within the class
            this.tsCodeComponents.properties.forEach((property) => {
                tsCode += `  ${property}\n`;
            });
            // Add methods within the class
            this.tsCodeComponents.methods.forEach((method) => {
                tsCode += `  ${method}\n`;
            });
            // Close the class block
            tsCode += "}\n";
        }
        else {
            // This is not a class but a module, so we include properties and methods at the top level
            // Add properties at the module level
            this.tsCodeComponents.properties.forEach((property) => {
                tsCode += `${property}\n`;
            });
            // Add methods at the module level
            this.tsCodeComponents.methods.forEach((method) => {
                tsCode += `${method}\n`;
            });
        }
        // We skip the original shell content because we assume it's being regenerated
        return tsCode;
    }
    // Helper function to classify .cjs files
    classifyFile(filePath) {
        if (filePath.includes("/controllers/"))
            return "controller";
        if (filePath.includes("/models/index"))
            return "modelIndex";
        if (filePath.includes("/models/"))
            return "model";
        if (fs.readFileSync(filePath, "utf8").includes("class "))
            return "class";
        return "module";
    }
    async convertProperties() {
        for (const property of this.cjsCodeComponents.properties) {
            const template = this.getTemplateForFileType(this.currentFileType);
            const systemMessage = propertiesConversionSystemMessage(template);
            const userMessage = propertiesConversionUserMessage(this.allTypes, this.fullCjsFile, this.fullProjectFileTree, this.currentStateOfTheConversion, property);
            // Call the LLM for each property
            const convertedProperty = await this.callLlm(systemMessage, userMessage);
            this.tsCodeComponents.properties.push(convertedProperty);
        }
    }
    generateIndentedFileTree(sourcePath, files) {
        const normalizedSourcePath = path.normalize(sourcePath);
        files.sort();
        let lastPathParts = [];
        const fileTree = files.map((filePath) => {
            const normalizedFilePath = path.normalize(filePath);
            // Split the path into parts
            const pathParts = normalizedFilePath
                .replace(normalizedSourcePath, "")
                .split(path.sep)
                .filter((part) => part !== "");
            // Initialize an array to hold the parts of the current path we will join for output
            let outputPathParts = [];
            // Determine how much of the path is shared with the last path
            let sharedPathLength = 0;
            while (sharedPathLength < pathParts.length &&
                sharedPathLength < lastPathParts.length &&
                pathParts[sharedPathLength] === lastPathParts[sharedPathLength]) {
                sharedPathLength++;
            }
            // Build the output path parts, including indentation
            for (let i = 0; i < pathParts.length; i++) {
                const indentation = "  ".repeat(i);
                if (i >= sharedPathLength) {
                    outputPathParts.push(`${indentation}${pathParts[i]}`);
                }
            }
            // Update lastPathParts for the next iteration
            lastPathParts = pathParts;
            // Join the output path parts for this file's line in the tree
            return outputPathParts.join("\n");
        });
        return fileTree.join("\n");
    }
    // Main function to convert files
    async convertFiles(sourcePath, extraTypePath = undefined) {
        const cjsFiles = this.findAllCjsFiles(sourcePath);
        //console.log(`all cjs files: ${cjsFiles}`)
        const tsFiles = this.findAllTsFiles(sourcePath);
        //console.log(`all ts files: ${tsFiles}`)
        const typeFiles = this.findAllTypeFiles(sourcePath);
        console.log(`all type files: ${typeFiles}`);
        this.fullProjectFileTree = this.generateIndentedFileTree(sourcePath, [
            ...cjsFiles,
            ...tsFiles,
            ...typeFiles,
        ]);
        console.log(`full project file tree: ${this.fullProjectFileTree}`);
        if (extraTypePath) {
            const extraTypeFiles = glob.sync(path.join(extraTypePath, "**", "*.d.ts"));
            typeFiles.push(...extraTypeFiles);
        }
        for (const file of typeFiles) {
            const content = await fs.readFile(file, "utf8");
            this.allTypes += content + "\n";
        }
        for (const file of cjsFiles) {
            console.log(`---------------> Processing file: ${file}`);
            this.currentFileType = this.classifyFile(file);
            this.fullCjsFile = "";
            this.fullCjsFile = await fs.readFile(file, "utf8");
            this.parseSourceCodeComponents();
            console.log(`Current file type: ${this.currentFileType}`);
            //console.log(`All types: ${this.allTypes}`);
            //console.log(`Full project file tree: ${this.fullProjectFileTree}`);
            console.log(`Full CJS file: ${this.fullCjsFile}`);
            console.log(`${JSON.stringify(this.cjsCodeComponents, null, 2)}`);
            console.log("Before imports conversion");
            await this.convertImports();
            console.log("After imports conversion");
            await this.convertProperties();
            console.log("After properties conversion");
            await this.convertMethods();
            console.log("After methods conversion");
            // Refine first time
            await this.refineMethods();
            console.log("After first refinement");
            // Refine a second time
            await this.refineMethods();
            console.log("After second refinement");
            // Save the new .ts file
            const newFilePath = file.replace(".cjs", ".ts");
            await fs.writeFile(newFilePath, this.currentStateOfTheConversion);
            console.log(`Final conversion state: ${JSON.stringify(this.currentStateOfTheConversion, null, 2)}`);
            this.tsCodeComponents = {
                imports: [],
                properties: [],
                methods: [],
                parentClass: null,
                shell: "",
            };
            // If new types are found, update the types.d.ts file
            // (This would involve analyzing the generated TypeScript code and updating type definitions accordingly)
        }
    }
}
const [, , sourcePath, extraTypePath] = process.argv;
if (!sourcePath) {
    console.error("Please provide a source path.");
    process.exit(1);
}
const convertCommonJsToTs = new ConvertCommonJsToTs();
convertCommonJsToTs
    .convertFiles(sourcePath, extraTypePath)
    .then(() => console.log("Conversion completed."));
//# sourceMappingURL=convertCommonJsToTs.js.map