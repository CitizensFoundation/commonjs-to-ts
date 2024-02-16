import * as fs from "fs-extra";
import * as path from "path";
import * as glob from "glob";
import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

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
  shellConversionSystemMessage,
  shellConversionUserMessage,
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
    const completion = await openaiClient.chat.completions.create({
      model: "gpt-4-0125-preview",
      temperature: 0.0,
      max_tokens: 4095,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
    });

    return completion.choices[0].message.content;
  }

  parseSourceCodeComponents() {
    const ast = parser.parse(this.fullCjsFile, {
      sourceType: "script",
      plugins: ["classProperties"],
    });

    traverse(ast, {
      ImportDeclaration(path) {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          this.cjsCodeComponents.imports.push(this.fullCjsFile.slice(start, end));
        }
      },
      ClassDeclaration(path) {
        if (path.node.superClass) {
          this.cjsCodeComponents.parentClass =
            path.node.superClass.type === "Identifier"
              ? path.node.superClass.name
              : null;
        }
      },
      ClassProperty(path) {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          this.cjsCodeComponents.properties.push(this.fullCjsFile.slice(start, end));
        }
      },
      ClassMethod(path) {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          this.cjsCodeComponents.methods.push(this.fullCjsFile.slice(start, end));
        }
      },
      FunctionDeclaration(path) {
        const { start, end } = path.node;
        if (start !== null && end !== null) {
          this.cjsCodeComponents.methods.push(this.fullCjsFile.slice(start, end));
        }
      },
    });
  }

  findAllCjsFiles(sourcePath: string): string[] {
    return glob.sync(path.join(sourcePath, "**", "*.cjs"));
  }

  findAllTsFiles(sourcePath: string): string[] {
    return glob.sync(path.join(sourcePath, "**", "*.ts"));
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

  private async convertShell(): Promise<string> {
    const template = this.getTemplateForFileType(this.currentFileType);
    const systemMessage = shellConversionSystemMessage(template);
    const userMessage = shellConversionUserMessage(
      this.allTypes,
      this.fullCjsFile,
      this.fullProjectFileTree,
      this.currentStateOfTheConversion
    );
    return this.callLlm(systemMessage, userMessage);
  }

  get currentStateOfTheConversion(): string {
    // TODO: Implement this
  }

  // Helper function to classify .cjs files
  classifyFile(filePath: string): string {
    if (filePath.includes("/controllers/")) return "controller";
    if (filePath.includes("/models/index")) return "modelIndex";
    if (filePath.includes("/models/")) return "model";
    if (fs.readFileSync(filePath, "utf8").includes("class ")) return "class";
    return "module";
  }

  generateIndentedFileTree(sourcePath: string, files: string[]): string {
    const normalizedSourcePath = path.normalize(sourcePath);

    // Sort files to get a more readable tree structure
    files.sort();

    const fileTree = files.map((filePath) => {
      // Normalize file path
      const normalizedFilePath = path.normalize(filePath);

      // Calculate the depth by comparing it with the sourcePath
      const depth = normalizedFilePath.split(path.sep).length - normalizedSourcePath.split(path.sep).length;

      // Create indentation based on depth
      const indentation = '  '.repeat(depth); // Using two spaces for each level of depth

      // Get the base name of the file for display
      const baseName = path.basename(filePath);

      // Return the indented file path
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
    const tsFiles = this.findAllTsFiles(sourcePath);
    const typeFiles = glob.sync(path.join(sourcePath, "**", "*.d.ts"));

    this.fullProjectFileTree = this.generateIndentedFileTree(sourcePath, [...cjsFiles, ...tsFiles, ...typeFiles]);

    if (extraTypePath) {
        const extraTypeFiles = glob.sync(path.join(extraTypePath, "**", "*.d.ts"));
        typeFiles.push(...extraTypeFiles);
    }

    for (const file of typeFiles) {
      const content = await fs.readFile(file, "utf8");
      this.allTypes += content + "\n";
    }

    for (const file of cjsFiles) {
      this.currentFileType = this.classifyFile(file);
      this.fullCjsFile = await fs.readFile(file, "utf8");

      this.parseSourceCodeComponents();

      await this.convertShell();


      // Save the new .ts file
      const newFilePath = file.replace(".cjs", ".ts");
      await fs.writeFile(newFilePath, tsContent);

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
