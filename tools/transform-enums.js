const fs = require('fs');
const readline = require('readline');
const path = require('path');

/**
 * Transforms C++ enums from a text file into a minified TypeScript class.
 * The enums can be retrieved from the game files or from a modding community
 * 
 * @param {string} inputPath Path to the Stalker2_enums.txt file.
 * @param {string} outputPath Path where the .ts file should be saved.
 */
async function transformEnums(inputPath, outputPath) {
    if (!fs.existsSync(inputPath)) {
        console.error(`Error: Input file not found at ${inputPath}`);
        process.exit(1);
    }

    const fileStream = fs.createReadStream(inputPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let currentEnum = null;
    let enums = {};

    console.log(`Reading enums from ${inputPath}...`);

    for await (const line of rl) {
        // Remove comments and trim
        const cleanLine = line.split('//')[0].trim();
        if (!cleanLine) continue;
        
        // Match enum class Start: enum class Name {
        const enumStartMatch = cleanLine.match(/^enum\s+(?:class\s+)?(\w+)\s*\{/);
        if (enumStartMatch) {
            currentEnum = enumStartMatch[1];
            enums[currentEnum] = {};
            continue;
        }

        // Match closing brace: };
        if (cleanLine.startsWith('};') && currentEnum) {
            currentEnum = null;
            continue;
        }

        // Match enum member: Name = Value,
        if (currentEnum) {
            // Regex handles decimal and hex values, and optional trailing comma
            const memberMatch = cleanLine.match(/^(\w+)\s*=\s*(-?\d+|0x[0-9a-fA-F]+),?/);
            if (memberMatch) {
                const name = memberMatch[1];
                const valueStr = memberMatch[2];
                // Store as number
                const value = valueStr.startsWith('0x') ? parseInt(valueStr, 16) : parseInt(valueStr, 10);
                enums[currentEnum][name] = value;
            }
        }
    }

    // Generate TypeScript: Minified directly
    console.log(`Generating minified TypeScript...`);
    let tsCode = 'export class StalkerEnums{';
    for (const [enumName, members] of Object.entries(enums)) {
        // Skip empty enums if any
        if (Object.keys(members).length === 0) continue;

        tsCode += `static readonly ${enumName}={`;
        const membersList = Object.entries(members).map(([name, value]) => `${name}:${value}`);
        tsCode += membersList.join(',');
        tsCode += '}as const;';
    }
    tsCode += '}';

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, tsCode);
    
    // Summary
    const enumCount = Object.keys(enums).length;
    const fileSize = (tsCode.length / 1024).toFixed(2);
    console.log(`Successfully transformed ${enumCount} enums to ${outputPath} (${fileSize} KB)`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node tools/transform-enums.js <input_path> <output_path>');
    process.exit(1);
}

transformEnums(path.resolve(args[0]), path.resolve(args[1]));
