import { nodes, state, root } from "membrane";

state.programsTasks = state.programsTasks || {};
state.memconfigs = state.memconfigs || {};
state.pulls = state.pulls || {};
let { memconfigs, programsTasks, pulls } = state;

export async function run({ program, modify }) {
  delete memconfigs[program];
  delete programsTasks[program];
  delete pulls[program];
  // get all programs names from membrane-io/directory
  let names: string[] = [];
  if (program) {
    names = [program];
  } else {
    throw new Error("program is required");
  }
  for (const name of names) {
    // get all program types
    const contentText: string = await nodes.user.repos
      .one({ name })
      .content.file({ path: "memconfig.json" }).contentText;
    const memconfig: any = JSON.parse(contentText);
    // save memconfig in state
    memconfigs[name] = memconfig;
    // get all types
    let types: any[] = memconfig.schema.types.map((type: any) => type);
    // modify are types to modify separated by comma
    if (modify) {
      const modifyTypes = modify.split(",");
      types = types.filter((t) => modifyTypes.includes(t.name));
    }
    for (const type of types) {
      const task = await nodes.agent.start({
        context: "autonoe:",
        objetive:
          "set descriptions for the following Type Schema, its members (fields, " +
          "actions, events and params)" +
          name +
          "'. If any of them doesn't have the property 'description', you should be able to create a new description property for each provided." +
          "\nThis is the program name '" +
          name +
          "' Type Schema: " +
          JSON.stringify(type, null, 2),
        additionalPrompt:
          "'events' -> each array element should have a 'description' property\n" +
          "'actions' -> each array element should have a 'description' property\n" +
          "'fields' -> each array element should have a 'description' property\n" +
          "'params' -> each array element should have a 'description' property\n" +
          "if the Type name is 'Root' the description should be something very short that self-explains what the functionality of the driver (e.g. 'Hacker News Driver', 'Github Driver', etc.)\n" +
          "Collection types (e.g. ItemCollection, UserCollection, etc.) should have a description in the following form: 'Collection of Hacker News items' or 'Collection of Github users'. " +
          "!IMPORTANT: dont forget to add the 'description' property to the params of the fields, actions and events",
      });
      await task.onResult.$subscribe(root.handler);
      programsTasks[name] = programsTasks[name] || [];
      programsTasks[name].push(task.id);
    }
  }
}
export async function handler(_, { event }) {
  const programs = Object.keys(programsTasks);

  // Remove the task from the respective program
  for (const name of programs) {
    const tasks = programsTasks[name];
    const index = tasks.indexOf(event.task.id);
    if (index > -1) {
      tasks.splice(index, 1);
    }
  }

  // Find programs without tasks and process them
  for (const name of programs) {
    if (programsTasks[name].length === 0) {
      try {
        await root.openPr({ program: name });
      } catch (error) {
        throw new Error(error);
      }
      delete programsTasks[name];
    }
  }
}

// Function to change type description
export async function changeTypeDescription({
  programName,
  typeName,
  description,
}) {
  const { type } = findType(programName, typeName);
  type.description = description;

  return `Successfully updated ${typeName} description to ${description}`;
}

// Function to change event description
export async function changeEventDescription({
  programName,
  memberName,
  typeName,
  description,
}) {
  const { type } = findType(programName, typeName);
  const event = type.events.find((e) => e.name === memberName);

  if (!event) {
    throw new Error(`Event ${memberName} not found in ${memberName}`);
  }
  event.description = description;
  return `Successfully updated description of ${typeName} ${memberName} to '${description}'`;
}

// Function to change action description
export async function changeActionDescription({
  programName,
  memberName,
  typeName,
  description,
}) {
  const { type } = findType(programName, typeName);
  const action = type.actions.find((f) => f.name === memberName);

  if (!action) {
    throw new Error(`Action ${memberName} not found in ${memberName}`);
  }

  action.description = description;
  return `Successfully added ${typeName} ${memberName} description to ${description}`;
}

// Function to change field description
export async function changeFieldDescription({
  programName,
  memberName,
  typeName,
  description,
}) {
  const { type } = findType(programName, typeName);
  const field = type.fields.find((f) => f.name === memberName);

  if (!field) {
    throw new Error(`Field ${memberName} not found in ${memberName}`);
  }

  field.description = description;
  return `Successfully added ${memberName} ${memberName} description to ${description}`;
}

// Function to change parameter description
export async function changeParamDescription({
  programName,
  typeName,
  memberName,
  paramName,
  description,
}) {
  const { type } = findType(programName, typeName);

  // Find the member within the type
  const member = findMember(type, memberName);

  // Locate the target parameter in the member
  const param = member.params?.find((p) => p.name === paramName);
  if (!param) {
    throw new Error(
      `Parameter ${paramName} not found in member ${memberName} of type ${typeName}`
    );
  }

  // Update the description of the parameter
  param.description = description;
  return `Successfully updated description of ${typeName}.${memberName}.${paramName} to '${description}'`;
}

export async function openPr({ program }) {
  pulls[program] = (pulls[program] || 0) + getRandom(1, 1000);
  const number = pulls[program];
  const repo = nodes.user.repos.one({ name: program });
  const memconfig = JSON.stringify(state.memconfigs[program], null, 2);

  await repo.branches.create({
    ref: "update-descriptions-" + number,
  });

  await repo.content
    .file({
      path: "memconfig.json",
    })
    .setContent({
      content: Buffer.from(memconfig).toString("base64"),
      message: "update membrane config",
      branch: "update-descriptions-" + number,
    });

  await repo.pull_requests.create({
    title: "update descriptions",
    head: "update-descriptions-" + number,
    base: "main",
  });
}

function getRandom(min: number, max: number) {
  return Math.floor(Math.random() * (max - min) + min);
}

function findMember(type: any, memberName: string) {
  const member =
    type.actions?.find((a) => a.name === memberName) ||
    type.fields?.find((f) => f.name === memberName) ||
    type.events?.find((e) => e.name === memberName);

  if (!member) {
    throw new Error(`Member ${memberName} not found`);
  }
  return member;
}

// Utility function to find type
function findType(programName: string, memberName: string) {
  const memconfig = memconfigs[programName];
  const type = memconfig.schema.types.find((t) => t.name === memberName);

  if (!type) {
    throw new Error(`Type ${memberName} not found in ${programName}`);
  }
  return { memconfig, type };
}
