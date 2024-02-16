export const controllerTemplate = `
import { createClient } from "redis";
import WebSocket, { WebSocketServer } from "ws";
//import models from "../models/index.js";
import models from "../models/index.cjs";

import auth from "../authorization.cjs";

import { v4 as uuidv4 } from "uuid";
import express, { Request, Response } from "express";
import crypto from "crypto";

const dbModels: Models = models;
const Group = dbModels.Group as GroupClass;

const PAIRWISE_API_HOST = process.env.PAIRWISE_API_HOST;
const PAIRWISE_USERNAME = process.env.PAIRWISE_USERNAME;
const PAIRWISE_PASSWORD = process.env.PAIRWISE_PASSWORD;

const defaultAuthHeader = {
  "Content-Type": "application/json",
  Authorization: \`Basic \${Buffer.from(
    \`\${PAIRWISE_USERNAME}:\${PAIRWISE_PASSWORD}\`
  ).toString("base64")}\`,
};

const defaultHeader = {
  ...{ "Content-Type": "application/json" },
  ...defaultAuthHeader,
};

//TODO: Do not duplicate from app.ts
interface YpRequest extends express.Request {
  ypDomain?: any;
  ypCommunity?: any;
  sso?: any;
  redisClient?: any;
  user?: any;
}

//import auth from "../authorization.js";
import { AiHelper } from "../active-citizen/engine/allOurIdeas/aiHelper.js";
import { ExplainAnswersAssistant } from "../active-citizen/engine/allOurIdeas/explainAnswersAssistant.js";
import OpenAI from "openai";
import { lang } from "moment";

export class AllOurIdeasController {
  public path = "/api/allOurIdeas";
  public router = express.Router();
  public wsClients: Map<string, WebSocket>;

  constructor(wsClients: Map<string, WebSocket>) {
    this.wsClients = wsClients;
    this.initializeRoutes();
  }

  public async initializeRoutes() {
    this.router.get(
      "/:groupId",
      auth.can("view group"),
      this.showEarl.bind(this)
    );
    this.router.post(
      "/:communityId/questions",
      auth.can("create group"),
      this.createQuestion.bind(this)
    );
    this.router.put(
      "/:communityId/generateIdeas",
      auth.can("create group"),
      this.generateIdeas.bind(this)
    );

    this.router.put(
      "/:groupId/llmAnswerExplain",
      auth.can("view group"),
      this.llmAnswerExplain.bind(this)
    );

    this.router.get(
      "/:communityId/choices/:questionId",
      auth.can("create group"),
      this.getChoices.bind(this)
    );

    this.router.get(
      "/:groupId/choices/:questionId/throughGroup",
      auth.can("view group"),
      this.getChoices.bind(this)
    );

    this.router.post(
      "/:groupId/questions/:questionId/prompts/:promptId/votes",
      auth.can("view group"),
      this.vote.bind(this)
    );

    this.router.post(
      "/:groupId/questions/:questionId/prompts/:promptId/skips",
      auth.can("view group"),
      this.skip.bind(this)
    );

    this.router.post(
      "/:groupId/questions/:questionId/addIdea",
      auth.can("view group"),
      this.addIdea.bind(this)
    );

    this.router.get(
      "/:groupId/questions/:wsClientSocketId/:analysisIndex/:analysisTypeIndex/analysis",
      auth.can("view group"),
      this.analysis.bind(this)
    );

    this.router.put(
      "/:communityId/questions/:questionId/choices/:choiceId",
      auth.can("create group"),
      this.updateCoiceData.bind(this)
    );

    this.router.put(
      "/:groupId/questions/:questionId/choices/:choiceId/throughGroup",
      auth.can("view group"),
      this.updateCoiceData.bind(this)
    );

    this.router.put(
      "/:communityId/questions/:questionId/choices/:choiceId/active",
      auth.can("create group"),
      this.updateActive.bind(this)
    );

    this.router.put(
      "/:communityId/questions/:questionId/name",
      auth.can("create group"),
      this.updateQuestionName.bind(this)
    );

    this.router.get(
      "/:groupId/content/:extraId/:questionId/translatedText",
      auth.can("view group"),
      this.getTranslatedText.bind(this)
    );

    this.router.get(
      "/:groupId/content/:extraId/translatedText",
      auth.can("view group"),
      this.getTranslatedText.bind(this)
    );
  }

  async addIdea(req: Request, res: Response) {
    const { newIdea, id } = req.body;
    let choiceParams = {
      visitor_identifier: req.session.id,
      data: {
        content: newIdea,
        isGeneratingImage: undefined,
      },
      question_id: req.params.questionId,
    };

    //@ts-ignore
    choiceParams["local_identifier"] = req.user ? req.user.id : req.session.id;

    console.log(\`choiceParams: \${JSON.stringify(choiceParams)}\`);

    try {
      const choiceResponse = await fetch(\`\${PAIRWISE_API_HOST}/choices.json\`, {
        method: "POST",
        headers: defaultAuthHeader,
        body: JSON.stringify(choiceParams),
      });

      if (!choiceResponse.ok) {
        console.error(choiceResponse.statusText);
        throw new Error("Choice creation failed.");
      }

      const choice = (await choiceResponse.json()) as AoiChoiceData;

      choice.data = JSON.parse(choice.data as any) as AoiAnswerToVoteOnData;

      let flagged = false;
      if (process.env.OPENAI_API_KEY) {
        flagged = await this.getModerationFlag(newIdea);
        if (flagged) {
          await this.deactivateChoice(req, choice.id);
          console.log("----------------------------------");
          console.log(\`Flagged BY OPENAI: \${flagged}\`);
          console.log("----------------------------------");
        } else {
          console.log(\`Not flagged BY OPENAI: \${flagged}\`);
        }
      }

      // Implement email notification logic based on choice's active status

      res.json({
        active: choice.active,
        flagged: flagged,
        choice: choice,
        choice_status: choice.active ? "active" : "inactive",
        message: \`You just submitted: \${escape(newIdea)}\`, // Use a proper escape function
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Addition of new idea failed" });
    }
  }


  public async getTranslatedText(req: Request, res: Response): Promise<void> {
    try {
      //@ts-ignore
      models.AcTranslationCache.getTranslation(
        req,
        {},
        function (error: string, translation: string) {
          if (error) {
            console.error(error);
            res.status(500).send("A getTranslatedText error occurred");
          } else {
            res.send(translation);
          }
        }
      );
    } catch (error) {
      console.error(error);
      res.status(500).send("A getTranslatedText error occurred");
    }
  }
}
`;
export const modelIndexTemplate = `
import { InitUser } from "./user";
import { InitProject } from "./project";
import { InitRole } from "./role";
import { InitRound } from "./round";
import { InitStage } from "./stage";
import { InitStory } from "./story";
import { InitMeeting } from "./meeting";
import { InitEmailCampaign } from "./emailCampaign";
import { InitSentEmail } from "./sentEmail";
import { InitIssue } from "./issue";
import { InitActionPlan } from "./actionPlan";
import { InitAction } from "./action";
import { InitScoreCard } from "./scoreCard";
import { InitComment } from "./comment";
import { InitProgressReport } from "./progressReport";
import { KeyObject } from "crypto";
import { InitTranslationCache } from "./translationCache";
import { InitRating } from "./rating";

const Sequelize = require("sequelize");

const env = process.env.NODE_ENV || "development";

let sequelize;

if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        rejectUnauthorized: false,
      },
    },
  });
} else {
  const config = require(\`\${__dirname}/../../config/config.json\`)[env];
  sequelize = new Sequelize(
    config.database,
    config.username,
    config.password,
    config
  );
}

export const models = {
  sequelize,
  Sequelize,
  Role: InitRole(sequelize),
  Project: InitProject(sequelize),
  User: InitUser(sequelize),
  Round: InitRound(sequelize),
  Stage: InitStage(sequelize),
  Story: InitStory(sequelize),
  Meeting: InitMeeting(sequelize),
  EmailCampaign: InitEmailCampaign(sequelize),
  SentEmail: InitSentEmail(sequelize),
  Issue: InitIssue(sequelize),
  ActionPlan: InitActionPlan(sequelize),
  Action: InitAction(sequelize),
  ScoreCard: InitScoreCard(sequelize),
  Comment: InitComment(sequelize),
  ProgressReport: InitProgressReport(sequelize),
  TranslationCache: InitTranslationCache(sequelize),
  Rating: InitRating(sequelize),
};

// Associations

// Project
models.Project.hasMany(models.Round, {
  sourceKey: "id",
  foreignKey: "projectId",
  as: "Rounds",
});

//models.Project.belongsTo(models.User,  { as: 'User', foreignKey: 'userId' });

models.Project.belongsToMany(models.User, {
  through: "ProjectUsers",
});

// User
/*models.User.hasMany(models.Project, {
  sourceKey: "id",
  foreignKey: "userId",
  as: "Projects"
});*/

models.User.belongsToMany(models.Role, {
  through: "UserRoles",
});

models.User.belongsToMany(models.Project, {
  through: "ProjectUsers",
});

models.User.hasMany(models.Role, {
  sourceKey: "id",
  foreignKey: "userId",
  as: "UserRoles",
});

models.User.hasMany(models.Comment, {
  sourceKey: "id",
  foreignKey: "userId",
});

// Round
models.Round.belongsTo(models.Project, {
  as: "Project",
  foreignKey: "projectId",
});

models.Round.hasMany(models.Meeting, {
  sourceKey: "id",
  foreignKey: "roundId",
  as: "Meetings",
});

models.Round.hasMany(models.Issue, {
  sourceKey: "id",
  foreignKey: "roundId",
  as: "Issues",
});

models.Round.hasMany(models.Rating, {
  sourceKey: "id",
  foreignKey: "roundId",
  as: "Ratings",
});

// Stage
models.Stage.belongsTo(models.Round, { as: "Round", foreignKey: "roundId" });

// Story
models.Stage.belongsTo(models.Project, {
  as: "Project",
  foreignKey: "projectId",
});

models.Story.belongsToMany(models.EmailCampaign, {
  through: "EmailCampaignStories",
});

models.Story.belongsToMany(models.Stage, {
  through: "StageStories",
});

// Meeting
models.Meeting.belongsTo(models.Round, { as: "Round", foreignKey: "roundId" });

// EmailCampaign
models.EmailCampaign.hasMany(models.SentEmail, {
  sourceKey: "id",
  foreignKey: "emailCampaignId",
  as: "SentEmails",
});

// SentEmail
models.SentEmail.belongsTo(models.EmailCampaign, {
  as: "EmailCampaign",
  foreignKey: "emailCampaignId",
});

// Issue
models.Issue.belongsTo(models.Round, { as: "Round", foreignKey: "roundId" });

models.Issue.belongsToMany(models.ScoreCard, {
  through: "ScoreCardIssues",
});

models.Issue.hasMany(models.Comment, {
  sourceKey: "id",
  foreignKey: "issueId",
});

models.Issue.hasMany(models.Action, {
  sourceKey: "id",
  foreignKey: "issueId",
});

models.Issue.hasMany(models.Rating, {
  sourceKey: "id",
  foreignKey: "issueId",
  as: "Ratings"
});

// ActionPlan
/*models.ActionPlan.hasMany(models.Action, {
  sourceKey: "id",
  foreignKey: "actionPlanId",
  as: "Actions",
});*/

// Action
models.Action.belongsTo(models.Issue, { as: "Issue", foreignKey: "issueId" });

/*models.Action.belongsTo(models.ActionPlan, {
  as: "ActionPlan",
  foreignKey: "actionPlanId",
});*/

// ScoreCard

// Comment

models.Comment.belongsTo(models.Issue, { as: "Issue", foreignKey: "issueId" });
models.Comment.belongsTo(models.Action, {
  as: "Action",
  foreignKey: "actionId",
});
models.Comment.belongsTo(models.User, { as: "User", foreignKey: "userId" });

// ProgressReport
models.ProgressReport.belongsTo(models.Action, {
  as: "Action",
  foreignKey: "actionId",
});

// Rating
models.Rating.belongsTo(models.Issue, { as: "Issue", foreignKey: "issueId" });

const force = process.env.FORCE_CSC_DB_SYNC ? true : false;

if (force) {
  sequelize.sync({ force }).then(async ()=>{}).catch((error: any) => {
}
`;
export const modelTemplate = `
import {
  Sequelize,
  Model,
  ModelDefined,
  DataTypes,
  HasManyGetAssociationsMixin,
  HasManyAddAssociationMixin,
  HasManyHasAssociationMixin,
  BelongsToManyAddAssociationMixin,
  Association,
  HasManyCountAssociationsMixin,
  HasManyCreateAssociationMixin,
  Optional,
  BelongsToManyGetAssociationsMixinOptions,
  BelongsToManyGetAssociationsMixin,
} from "sequelize";

import express from "express";

import { User } from "./user";
import { Round } from "./round";
import { models } from ".";

interface ProjectCreationAttributes extends Optional<ProjectAttributes, "id"> {}

export class Project
  extends Model<ProjectAttributes, ProjectCreationAttributes>
  implements ProjectAttributes {
  public id!: number;
  public userId!: number;
  public name!: string;
  public description!: string;
  public language!: string | null;
  public publicData!: ProjectPublicDataAttributes | null;

  // timestamps!
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Since TS cannot determine model association at compile time
  // we have to declare them here purely virtually
  public getRound!: HasManyGetAssociationsMixin<Round>; // Note the null assertions!
  public addRound!: HasManyAddAssociationMixin<Round, number>;

  public getUser!: BelongsToManyGetAssociationsMixin<User>; // Note the null assertions!
  public addUser!: BelongsToManyAddAssociationMixin<User, number>;

  // You can also pre-declare possible inclusions, these will only be populated if you
  // actively include a relation.
  public readonly Rounds?: Round[]; // Note this is optional since it's only populated when explicitly requested in code
  public readonly Users?: User[]; // Note this is optional since it's only populated when explicitly requested in code

  public static associations: {
    Rounds: Association<Project, Round>,
    Users: Association<Project, User>
  };

  public static async addParticipants(body: ParticipantsUploadAttributes, res: express.Response) {
    const lines = body.participants.split("\n");
    const roleId = body.roleId+1;
    const language = body.language;
    const projectId = body.projectId;

    try {
      const role = await models.Role.findOne({
        where: {
          id: roleId
        }
      })
      for (let i=0; i<lines.length;i++) {
        if (lines[i].length>10) {
          const splitLine = lines[i].split(",")
          const email = splitLine[0];
          const name = splitLine[1];
          const user = await models.User.create({
            name,
            email,
            language,
            encrypedPassword: "12345"
          });

          await user.addRole(role!);

          console.error("pr "+projectId);

          const project = await models.Project.findOne({
            where: {
              id: projectId
            }
          })

          if (!project) {
            res.sendStatus(404);
            break;
          } else {
            user.addProject(project);
          }
        }
      }

      res.sendStatus(200);
    } catch(error) {
      console.error(error);
      res.sendStatus(500);
    }
  }
}

export const InitProject = (sequelize: Sequelize) => {
  Project.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: new DataTypes.STRING(256),
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      language: {
        type: new DataTypes.STRING(10),
        allowNull: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      publicData: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      timestamps: true,
      paranoid: true,
      tableName: "projects",
      sequelize,
    }
  );

  return Project
};

`;
export const classTemplate = `
import { jsonrepair } from "jsonrepair";
import { OpenAI } from "openai";
import { YpLanguages } from "../../utils/ypLanguages.js";
import { parse } from "path";
import { Translate } from "aws-sdk";
import * as cheerio from "cheerio";
import { Cheerio, Element } from "cheerio";

export class YpLlmTranslation {
  openaiClient: OpenAI;
  modelName = "gpt-4-0125-preview";
  maxTokens = 4000;
  temperature = 0.0;

  constructor() {
    this.openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  extractHtmlStrings(html: string): string[] {
    const $ = cheerio.load(html);
    const strings: string[] = [];

    // Function to recursively extract text from all elements
    function recursivelyExtractText(elements: Cheerio<Element>): void {
      elements.each((index, element) => {
        if (element.tagName === 'script') {
          return;
        }
        // Check if the element itself contains a direct text node
        $(element)
          .contents()
          .filter((idx, content) => {
            // Ensure that content is a text node and not empty
            return (
              content.type === "text" && $(content).text().trim().length > 0
            );
          })
          .each((idx, content) => {
            const text = $(content).text().trim();
            if (text) {
              strings.push(text);
            }
          });

        // Recursively extract text from child elements
        recursivelyExtractText($(element).children());
      });
    }

    // Start the recursive text extraction from the body or root of the document
    recursivelyExtractText($("body").length ? $("body") : $.root());

    // Attributes with user-facing text
    $("input[placeholder], input[value]").each((index, element) => {
      const placeholder = $(element).attr("placeholder");
      if (placeholder && placeholder.trim().length > 0) {
        strings.push(placeholder.trim());
      }
      const value = $(element).attr("value");
      if (
        value &&
        $(element).attr("type") !== "text" &&
        value.trim().length > 0
      ) {
        strings.push(value.trim());
      }
    });

    // Return unique non-empty strings
    return [...new Set(strings)];
  }

   ...

  renderOneTranslationSystemMessage() {
    return \`You are a helpful answer translation assistant that knows all the world languages.
      INPUTS:
      The user will tell us the Language to translate to.
      The user will give you a string to be translated.

      OUTPUT:
      You will output only the translated string.

      INSTRUCTIONS:
      Keep it similar length as the original text.
      Translate the tone of the original language also.
      NEVER output anything else than the translated string.\`;
  }

  renderListTranslationSystemMessage() {
    return \`You are a helpful translation assistant that knows all the world languages.

      INPUTS:
      The user will tell us the Language to translate to.

      You will get JSON with an array of strings to translate:
      [
        "string",
        ...
      ]

      OUTPUT:
      You will output JSON string array in the same order as the input array.
      [
        "string",
        ...
      ]


      INSTRUCTIONS:
      Do not translate brand names including ours: All Our Ideas and Your Priorities except it is a well known brand in the target language.
      Always output only a JSON string array.\`;
  }

  // User messages

  renderOneTranslationUserMessage(language: string, stringToTranslate: string) {
    return \`Language to translate to: \${language}
      String to translate:
      \${stringToTranslate}
      Your translated string:\`;
  }

  renderListTranslationUserMessage(
    language: string,
    textsToTranslate: Array<string>
  ) {
    return \`Language to translate to: \${language}
      Texts to translate in JSON string array:
      \${JSON.stringify(textsToTranslate, null, 2)}

      Your \${language} translations as JSON string array:\`;
  }

  renderAnswersUserMessage(
    language: string,
    question: string,
    answer: AoiTranslationAnswerInData
  ) {
    return \`Language to translate to: \${language}

    Question:
    \${question}

    Answers to translate in JSON Input:
    \${JSON.stringify(answer, null, 2)}

    Your \${language} JSON output:\`;
  }

  renderQuestionUserMessage(
    language: string,
    question: string,
    questionData: AoiTranslationQuestionInData
  ) {
    return \`Language to translate to: \${language}

    Question to translate in JSON format:
    \${JSON.stringify(questionData, null, 2)}

    Your \${language} JSON output:\`;
  }

  async getModerationFlag(content: string): Promise<boolean> {
    const moderationResponse = await this.openaiClient.moderations.create({
      input: content,
    });
    console.log("Moderation response:", moderationResponse);
    const flagged = moderationResponse.results[0].flagged;
    return flagged;
  }

  async getHtmlTranslation(
    languageIsoCode: string,
    htmlToTranslate: string
  ): Promise<string | null | undefined> {
    try {
      const originalStrings = this.extractHtmlStrings(htmlToTranslate);
      if (originalStrings.length === 0) {
        console.warn("No HTML strings to translate");
        return htmlToTranslate;
      }

      const batchSize = 10;
      const translatedStrings: string[] = [];
      for (let i = 0; i < originalStrings.length; i += batchSize) {
        const batch = originalStrings.slice(i, i + batchSize);
        const translatedBatch = await this.getListTranslation(
          languageIsoCode,
          batch
        );
        if (translatedBatch) {
          translatedStrings.push(...translatedBatch);
        } else {
          console.error("Failed to translate batch:", batch);
          return undefined;
        }
      }

      // Replace original strings in HTML with their translations
      const translatedHtml = this.replaceHtmlStrings(
        htmlToTranslate,
        originalStrings,
        translatedStrings
      );
      return translatedHtml;
    } catch (error) {
      console.error("Error in getHtmlTranslation:", error);
      return undefined;
    }
  }

  async getOneTranslation(
    languageIsoCode: string,
    stringToTranslate: string
  ): Promise<string | null | undefined> {
    try {
      console.log(\`getOneTranslation: \${stringToTranslate} \${languageIsoCode}\`);
      const languageName =
        YpLanguages.getEnglishName(languageIsoCode) || languageIsoCode;
      return (await this.callSimpleLlm(
        languageName,
        stringToTranslate,
        false,
        this.renderOneTranslationSystemMessage,
        this.renderOneTranslationUserMessage
      )) as string | null;
    } catch (error) {
      console.error("Error in getAnswerIdeas:", error);
      return undefined;
    }
  }

  async getListTranslation(
    languageIsoCode: string,
    stringsToTranslate: string[]
  ): Promise<string[] | null | undefined> {
    try {
      console.log(\`getOneTranslation: \${languageIsoCode}\`);
      const languageName =
        YpLanguages.getEnglishName(languageIsoCode) || languageIsoCode;
      if (await this.getModerationFlag(stringsToTranslate.join(" "))) {
        console.error("Flagged:", stringsToTranslate);
        return null;
      } else {
        return (await this.callSimpleLlm(
          languageName,
          stringsToTranslate,
          true,
          this.renderListTranslationSystemMessage,
          this.renderListTranslationUserMessage
        )) as string[] | null;
      }
    } catch (error) {
      console.error("Error in getAnswerIdeas:", error);
      return undefined;
    }
  }

  ...

  async callSimpleLlm(
    languageName: string,
    toTranslate: string[] | string,
    parseJson: boolean,
    systemRenderer: Function,
    userRenderer: Function
  ): Promise<string | object | null | undefined> {
    const messages = [
      {
        role: "system",
        content: systemRenderer(),
      },
      {
        role: "user",
        content: userRenderer(languageName, toTranslate),
      },
    ] as any;

    const maxRetries = 3;
    let retries = 0;

    let running = true;

    while (running) {
      try {
        console.log(\`Messages \${retries}:\`, messages);
        const results = await this.openaiClient.chat.completions.create({
          model: this.modelName,
          messages,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
        });

        console.log("Results:", results);
        let llmOutput = results.choices[0].message.content;
        console.log("Return text:", llmOutput);
        if (parseJson) {
          if (llmOutput) {
            llmOutput = llmOutput.replace(/\`\`\`json/g, "");
            llmOutput = llmOutput.replace(/\`\`\`/g, "");
            return JSON.parse(jsonrepair(llmOutput!));
          } {
            console.error("No content in response");
            return undefined;
          }
        } else {
          return llmOutput;
        }
      } catch (error) {
        console.error("Error in getChoiceTranslation:", error);
        retries++;
        if (retries > maxRetries) {
          running = false;
          return undefined;
        }
      }
    }
  }

  async callSchemaLlm(
    jsonInSchema: string,
    jsonOutSchema: string,
    lengthInfo: string,
    languageName: string,
    question: string,
    toTranslate:
      | AoiTranslationAnswerInData
      | AoiTranslationQuestionInData
      | string[]
      | string,
    maxCharactersInTranslation: number | undefined,
    systemRenderer: Function,
    userRenderer: Function
  ): Promise<string | null | undefined> {
    console.log(
      "Call schema LLM:",
      jsonInSchema,
      jsonOutSchema,
      lengthInfo,
      languageName,
      question,
      toTranslate,
      maxCharactersInTranslation
    );
    const messages = [
      {
        role: "system",
        content: this.renderSchemaSystemMessage(
          jsonInSchema,
          jsonOutSchema,
          lengthInfo
        ),
      },
      {
        role: "user",
        content: userRenderer(languageName, question, toTranslate),
      },
    ] as any;

    const maxRetries = 5;
    let retries = 0;

    let running = true;

    while (running) {
      try {
        console.log(\`Messages \${retries}:\`, messages);
        const results = await this.openaiClient.chat.completions.create({
          model: this.modelName,
          messages,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
        });

        console.log("Results:", results);
        let textJson = results.choices[0].message.content;
        console.log("Text JSON:", textJson);

        if (textJson) {
          textJson = textJson.replace(/\`\`\`json/g, "");
          textJson = textJson.replace(/\`\`\`/g, "");
          const translationData = JSON.parse(
            jsonrepair(textJson)
          ) as AoiTranslationAnswerOutData;
          if (translationData && translationData.translatedContent) {
            if (
              maxCharactersInTranslation &&
              translationData.translatedContent.length >
                maxCharactersInTranslation
            ) {
              console.log(
                "Translation too long retrying:",
                translationData.translatedContent
              );
              messages[0].content = this.renderSchemaTryAgainSystemMessage(
                jsonInSchema,
                jsonOutSchema,
                lengthInfo,
                translationData.translatedContent
              );

              throw new Error("Translation too long");
            }
            running = false;
            console.log("Return text " + translationData.translatedContent);
            return translationData.translatedContent;
          } else {
            this.temperature = Math.random() * 0.99;
            console.log(
              "No content in response. Temperature set to: " + this.temperature
            );
            throw new Error("No content in response");
          }
        } else {
          this.temperature = Math.random() * 0.99;
          console.log(
            "No content in response. Temperature set to:" + this.temperature
          );
          throw new Error("No content in response");
        }
      } catch (error) {
        console.error("Error in callSchemaLlm:", error);
        retries++;
        if (retries > maxRetries) {
          running = false;
          return undefined;
        }
      }
    }
  }
}
`;
export const moduleTemplate = `
import * as bunyan from 'bunyan';
import PrettyStream from 'bunyan-prettystream';

let logger: bunyan;

if (process.env.USE_BUNYAN_LOGGER && process.env.NODE_ENV !== 'production') {
  const prettyStdOut = new PrettyStream();
  prettyStdOut.pipe(process.stdout);

  logger = bunyan.createLogger({
    name: 'yrpri',
    streams: [{
      level: 'debug',
      type: 'raw',
      stream: prettyStdOut
    }]
  });
} else {
  if (process.env.USE_BUNYAN_LOGGER) {
    logger = bunyan.createLogger({ name: "your-priorities" });
  } else {
    // If you don't want to use any logger, you can assign 'console' to 'logger'.
    // However, you need to cast it to any as 'console' and 'bunyan' have different types.
    logger = console as any;
  }
}

export default logger;
`;
//# sourceMappingURL=codeTemplates.js.map