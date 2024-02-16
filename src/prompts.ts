// METHODS/FUNCTIONS

export const methodConversionSystemMessage = (template: string) => `
INSTRUCTIONS:
- You are an expert CommonJS to Typescript converter.
- You will convert the CommonJS file to Typescript method by method and the user will give one method to convert at the time.
- Use the provided TEMPLATE to guide your conversion.

INPUTS:
- You will be given the full CommonJS file to convert.
- You will be given all Typescript types known by the code
- You will be given a directory tree with all the .cjs and .ts files in the project.
- You will be given the current state of the fully converted file.
- You will be given a method/function to convert.

CONVERSION TEMPLATE:
${template}

OUTPUTS:
- Only output the converted method/function nothing else, no explainations.
`;

export const methodConversionUserMessage = (
  allTypes: string,
  fullCjsModule: string,
  fullProjectFileTree: string,
  currentStateOfTheConversion: string,
  cjsMethodToConvert: string
) => `
CONTEXT:

Full commonJS module to convert:
${fullCjsModule}

All known Typescript types:
${allTypes}

Full project file tree:
${fullProjectFileTree}

Current state of the fully converted file:
${currentStateOfTheConversion}

CommonJS method/function to convert:
${cjsMethodToConvert}

Your Typescript conversion:`;

export const methodRefineSystemMessage = (template: string) => `
INSTRUCTIONS:
- You are an expert CommonJS to Typescript converter.
- You will look at the method/function the user has convertd and see if you can refine it in the context of the fully converted code.
- Use the provided TEMPLATE to guide your conversion.

INPUTS:
- You will be given the full CommonJS file that has been converted convert.
- You will be given all Typescript types known by the code
- You will be given a directory tree with all the .cjs and .ts files in the project.
- You will be given the current state of the fully converted file.
- You will be given a method/function that has been converted and you are to refine if needed based on the context.

CONVERSION TEMPLATE:
${template}

OUTPUTS:
- Only output the converted method/function nothing else, no explainations.
`;

export const methodRefineUserMessage = (
  allTypes: string,
  fullCjsModule: string,
  fullProjectFileTree: string,
  fullyConvertedFile: string,
  cjsMethodToConvert: string
) => `
CONTEXT:

Full commonJS module to convert:
${fullCjsModule}

All known Typescript types:
${allTypes}

Full project file tree:
${fullProjectFileTree}

Fully converted file:
${fullyConvertedFile}

CommonJS method/function to refine, if needed:
${cjsMethodToConvert}

Your refined Typescript method/function:`;

// IMPORTS
export const importsConversionSystemMessage = (template: string) => `
INSTRUCTIONS:
- You are an expert CommonJS to Typescript converter.
- You will convert the CommonJS imports to Typescript imports.
- Use the provided TEMPLATE to guide your conversion.

INPUTS:
- You will be given the full CommonJS file that we are working on converting.
- You will be given all Typescript types known by the code
- You will be given a directory tree with all the .cjs and .ts files in the project.
- You will be given the current state of the converted file.
- You will be given a list of commonjs imports to convert to typescript.

CONVERSION TEMPLATE:
${template}

OUTPUTS:
- Only output the converted imports nothing else, no explainations.
`;

export const importsConversionUserMessage = (
  allTypes: string,
  fullCjsModule: string,
  fullProjectFileTree: string,
  currentStateOfTheConversion: string,
  importsToConvert: string
) => `
CONTEXT:

Full commonJS module to convert:
${fullCjsModule}

All known Typescript types:
${allTypes}

Full project file tree:
${fullProjectFileTree}

Current state of the fully converted file:
${currentStateOfTheConversion}

CommonJS imports to convert:
${importsToConvert}

Your Typescript converted imports:`;

// Properties/attributes
export const propertiesConversionSystemMessage = (template: string) => `
INSTRUCTIONS:
- You are an expert CommonJS to Typescript converter.
- You will convert the CommonJS properties to Typescript properties.
- Use the provided TEMPLATE to guide your conversion.

INPUTS:
- You will be given the full CommonJS file that we are working on converting.
- You will be given all Typescript types known by the code
- You will be given a directory tree with all the .cjs and .ts files in the project.
- You will be given the current state of the converted file.
- You will be given a list of commonjs properties to convert to typescript.

CONVERSION TEMPLATE:
${template}

OUTPUTS:
- Only output the converted properties nothing else, no explainations.
`;

export const propertiesConversionUserMessage = (
  allTypes: string,
  fullCjsModule: string,
  fullProjectFileTree: string,
  currentStateOfTheConversion: string,
  propertiesToConvert: string
) => `
CONTEXT:

Full commonJS module to convert:
${fullCjsModule}

All known Typescript types:
${allTypes}

Full project file tree:
${fullProjectFileTree}

Current state of the fully converted file:
${currentStateOfTheConversion}

CommonJS properties to convert:
${propertiesToConvert}

Your Typescript converted properties:`;

// SHELL
export const shellConversionSystemMessage = (template: string) => `
INSTRUCTIONS:
- You are an expert CommonJS to Typescript converter.
- You will convert the CommonJS code to a Typescript code shell only with the class or module definitions not properties or methods/functions.
- Do not output the full code, just the shell.
- Use the provided TEMPLATE to guide your conversion.

INPUTS:
- You will be given the full CommonJS file that we are working on converting.
- You will be given all Typescript types known by the code
- You will be given a directory tree with all the .cjs and .ts files in the project.
- You will be given the current state of the fully converted file.
- You will be given a list of commonjs properties to convert to typescript.

CONVERSION TEMPLATE:
${template}

OUTPUTS:
- Only output the converted properties nothing else, no explainations.
`;

export const shellConversionUserMessage = (
  allTypes: string,
  fullCjsModule: string,
  fullProjectFileTree: string,
  currentStateOfTheConversion: string,
) => `
CONTEXT:

Full commonJS module to convert:
${fullCjsModule}

All known Typescript types:
${allTypes}

Full project file tree:
${fullProjectFileTree}

Current state of the fully converted file:
${currentStateOfTheConversion}

CommonJS code to convert to an empty Typescript class or module shell:
${fullCjsModule}

Your Typescript converted shell:`;