import fs from "fs-extra";
import * as path from "path";
import * as glob from "glob";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = _traverse.default;
import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";

import {
  classTemplate,
  moduleTemplate,
  controllerTemplate,
  modelIndexTemplate,
  modelTemplate,
} from "./codeTemplates.js";

import {
  methodConversionSystemMessage,
  methodRefineSystemMessage,
  importsConversionSystemMessage,
  importsConversionUserMessage,
  methodConversionUserMessage,
  methodRefineUserMessage,
  propertiesConversionSystemMessage,
  propertiesConversionUserMessage,
} from "./prompts.js";

import { OpenAI } from "openai";

const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface CodeComponents {
  imports: string[];
  properties: string[];
  methods: string[];
  parentClass: string | null;
  shell: string;
}

class ConvertCommonJsToTs {
  cjsCodeComponents: CodeComponents = {
    imports: [],
    properties: [],
    methods: [],
    parentClass: null,
    shell: "",
  };

  tsCodeComponents: CodeComponents = {
    imports: [],
    properties: [],
    methods: [],
    parentClass: null,
    shell: "",
  };

  allTypes: string = "";
  fullCjsFile: string = "";
  fullProjectFileTree: string = "";
  currentFileType: string = "";

  async callLlm(systemMessage: string, userMessage: string) {
    console.log("Calling LLM");
    //console.log(`System message: ${systemMessage}`);
    //console.log(`User message: ${userMessage}`);
    console.log("-----------------------------------------------------------");
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

    console.log(`----------------------> LLM Output: ${llmOutput}`);

    return llmOutput || "";
  }

  parseSourceCodeComponents() {
    const ast = parser.parse(this.fullCjsFile, {
      sourceType: "script",
      plugins: ["classProperties"],
    });

    traverse(ast, {
      ClassDeclaration: (path: NodePath<t.ClassDeclaration>) => {
        if (path.node.superClass) {
          const superClass = path.node.superClass;

          // If superClass is an Identifier, which is a common case, get its name
          if (t.isIdentifier(superClass)) {
            this.cjsCodeComponents.parentClass = superClass.name;
          }
        }
      },
      ImportDeclaration: (path: NodePath<t.ImportDeclaration>) => {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          this.cjsCodeComponents.imports.push(
            this.fullCjsFile.slice(start, end)
          );
        }
      },
      ClassProperty: (path: NodePath<t.ClassProperty>) => {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          this.cjsCodeComponents.properties.push(
            this.fullCjsFile.slice(start, end)
          );
        }
      },
      ClassMethod: (path: NodePath<t.ClassMethod>) => {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          this.cjsCodeComponents.methods.push(
            this.fullCjsFile.slice(start, end)
          );
        }
      },
      FunctionDeclaration: (path: NodePath<t.FunctionDeclaration>) => {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          this.cjsCodeComponents.methods.push(
            this.fullCjsFile.slice(start, end)
          );
        }
      },
    });
  }
  private async refineMethods(): Promise<void> {
    const refinedMethods: string[] = [];

    for (const method of this.tsCodeComponents.methods) {
      // Use the template for refining methods, could be adjusted if different templates are needed
      const template = this.getTemplateForFileType(this.currentFileType);
      const systemMessage = methodRefineSystemMessage(template);

      // Constructing the user message for refining the method
      const userMessage = methodRefineUserMessage(
        this.allTypes,
        this.fullCjsFile,
        this.fullProjectFileTree,
        // Assuming the fully converted file is a concatenation of all parts so far for context
        this.currentStateOfTheConversion,
        method // The specific TypeScript method to refine
      );

      // Call the LLM for refining each TypeScript method
      const refinedMethod = await this.callLlm(systemMessage, userMessage);
      refinedMethods.push(refinedMethod.trim());
    }

    // Update the tsCodeComponents.methods with the refined methods
    this.tsCodeComponents.methods = refinedMethods;
  }

  findAllCjsFiles(sourcePath: string): string[] {
    return glob.sync(path.join(sourcePath, "**", "*.cjs"), {
      ignore: ["**/node_modules/**", "**/ts-out/**"],
    });
  }

  findAllTsFiles(sourcePath: string): string[] {
    return glob.sync(path.join(sourcePath, "**", "*.ts"), {
      ignore: ["**/node_modules/**", "**/ts-out/**"],
    });
  }

  findAllTypeFiles(sourcePath: string): string[] {
    return glob.sync(path.join(sourcePath, "**", "*.d.ts"), {
      ignore: ["**/node_modules/**", "**/ts-out/**"],
    });
  }

  private getTemplateForFileType(fileType: string): string {
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

  private async convertImports(): Promise<void> {
    for (const singleImport of this.cjsCodeComponents.imports) {
      const template = this.getTemplateForFileType(this.currentFileType);
      const systemMessage = importsConversionSystemMessage(template);
      const userMessage = importsConversionUserMessage(
        this.allTypes,
        this.fullCjsFile,
        this.fullProjectFileTree,
        this.currentStateOfTheConversion,
        singleImport // Pass each import individually
      );

      // Call the LLM for each import
      const convertedImport = await this.callLlm(systemMessage, userMessage);
      this.tsCodeComponents.imports.push(convertedImport);
    }
  }

  private async convertMethods(): Promise<void> {
    for (const method of this.cjsCodeComponents.methods) {
      // Construct the template based on the current file type
      const template = this.getTemplateForFileType(this.currentFileType);

      // System message instructs the LLM on the conversion task
      const systemMessage = methodConversionSystemMessage(template);

      // User message provides the context and specifics for the conversion
      const userMessage = methodConversionUserMessage(
        this.allTypes,
        this.fullCjsFile,
        this.fullProjectFileTree,
        this.currentStateOfTheConversion,
        method // The specific method to convert
      );

      // Call the LLM for each method
      const convertedMethod = await this.callLlm(systemMessage, userMessage);
      this.tsCodeComponents.methods.push(convertedMethod);
    }
  }

  get currentStateOfTheConversion(): string {
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
    } else {
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
  classifyFile(filePath: string): string {
    if (filePath.includes("/controllers/")) return "controller";
    if (filePath.includes("/models/index")) return "modelIndex";
    if (filePath.includes("/models/")) return "model";
    if (fs.readFileSync(filePath, "utf8").includes("class ")) return "class";
    return "module";
  }

  private async convertProperties(): Promise<void> {
    for (const property of this.cjsCodeComponents.properties) {
      const template = this.getTemplateForFileType(this.currentFileType);
      const systemMessage = propertiesConversionSystemMessage(template);
      const userMessage = propertiesConversionUserMessage(
        this.allTypes,
        this.fullCjsFile,
        this.fullProjectFileTree,
        this.currentStateOfTheConversion,
        property
      );

      // Call the LLM for each property
      const convertedProperty = await this.callLlm(systemMessage, userMessage);
      this.tsCodeComponents.properties.push(convertedProperty);
    }
  }

  generateIndentedFileTree(sourcePath: string, files: string[]): string {
    const normalizedSourcePath = path.normalize(sourcePath);

    files.sort();

    const fileTree = files.map((filePath) => {
      const normalizedFilePath = path.normalize(filePath);

      const depth =
        normalizedFilePath.split(path.sep).length -
        normalizedSourcePath.split(path.sep).length;

      const indentation = "  ".repeat(depth); // Using two spaces for each level of depth

      const baseName = path.basename(filePath);

      return `${indentation}${baseName}`;
    });

    return fileTree.join("\n");
  }

  // Main function to convert files
  async convertFiles(
    sourcePath: string,
    extraTypePath: string | undefined = undefined
  ) {
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

    if (extraTypePath) {
      const extraTypeFiles = glob.sync(
        path.join(extraTypePath, "**", "*.d.ts")
      );
      typeFiles.push(...extraTypeFiles);
    }

    for (const file of typeFiles) {
      const content = await fs.readFile(file, "utf8");
      this.allTypes += content + "\n";
    }

    for (const file of cjsFiles) {
      console.log(`---------------> Processing file: ${file}`);
      this.currentFileType = this.classifyFile(file);
      this.fullCjsFile = await fs.readFile(file, "utf8");

      this.parseSourceCodeComponents();

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
