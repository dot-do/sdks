/**
 * Init command - scaffold a new .do domain repo from template
 */
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { generateNamingConventions, processTemplate, directoryExists, } from '../utils/template.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * Print colored output
 */
function print(message, color) {
    const colors = {
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        red: '\x1b[31m',
        cyan: '\x1b[36m',
        dim: '\x1b[2m',
        reset: '\x1b[0m',
    };
    if (color) {
        console.log(`${colors[color]}${message}${colors.reset}`);
    }
    else {
        console.log(message);
    }
}
/**
 * Check if gh CLI is available
 */
function hasGhCli() {
    try {
        execSync('gh --version', { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Create GitHub repository using gh CLI
 */
async function createGitHubRepo(name, targetDir, options) {
    const org = options.org ?? 'dot-do';
    const repoName = `${name}.do`;
    const visibility = options.private ? '--private' : '--public';
    try {
        // Initialize git repo if not already
        execSync('git init', { cwd: targetDir, stdio: 'ignore' });
        // Create GitHub repo
        print(`Creating GitHub repository ${org}/${repoName}...`, 'cyan');
        execSync(`gh repo create ${org}/${repoName} ${visibility} --source=. --remote=origin`, { cwd: targetDir, stdio: 'inherit' });
        return true;
    }
    catch (error) {
        print(`Failed to create GitHub repository: ${error}`, 'red');
        return false;
    }
}
/**
 * Execute the init command
 */
export async function init(name, options = {}) {
    // Validate name
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
        print('Error: Name must start with a letter and contain only lowercase letters, numbers, and hyphens.', 'red');
        process.exit(1);
    }
    // Generate naming conventions
    const conventions = generateNamingConventions(name, options.description);
    // Determine target directory
    const targetDir = resolve(options.dir ?? `./${conventions['name.do']}`);
    // Check if directory already exists
    if (await directoryExists(targetDir)) {
        print(`Error: Directory "${targetDir}" already exists and is not empty.`, 'red');
        process.exit(1);
    }
    print(`\nScaffolding ${conventions['name.do']} repo...\n`, 'cyan');
    // Get template directory
    // Try multiple possible template locations:
    // 1. Published package: cli/template (copied during build)
    // 2. Development: ../template (sibling to cli/)
    const { stat } = await import('node:fs/promises');
    const possiblePaths = [
        join(__dirname, '..', '..', 'template'), // cli/dist/commands -> cli/template
        join(__dirname, '..', '..', '..', 'template'), // cli/dist/commands -> template (dev)
    ];
    let templateDir = null;
    for (const path of possiblePaths) {
        try {
            await stat(path);
            templateDir = path;
            break;
        }
        catch {
            // Try next path
        }
    }
    if (!templateDir) {
        print(`Error: Template directory not found. Searched:`, 'red');
        for (const path of possiblePaths) {
            print(`  ${path}`, 'dim');
        }
        process.exit(1);
    }
    // Create target directory
    await mkdir(targetDir, { recursive: true });
    // Process template
    try {
        const files = await processTemplate(templateDir, targetDir, conventions);
        print('Created files:', 'green');
        for (const file of files.sort()) {
            print(`  ${file}`, 'dim');
        }
    }
    catch (error) {
        print(`Error processing template: ${error}`, 'red');
        process.exit(1);
    }
    // Initialize git repo
    try {
        execSync('git init', { cwd: targetDir, stdio: 'ignore' });
        print('\nInitialized git repository.', 'dim');
    }
    catch {
        // Git init failed, not critical
    }
    // Create GitHub repo if requested
    if (options.github) {
        if (!hasGhCli()) {
            print('\nWarning: gh CLI not found. Install it to create GitHub repos automatically.', 'yellow');
            print('  https://cli.github.com/', 'dim');
        }
        else {
            await createGitHubRepo(name, targetDir, {
                org: options.org,
                private: options.private,
            });
        }
    }
    // Print next steps
    print('\nNext steps:', 'green');
    print(`  cd ${conventions['name.do']}`, 'cyan');
    print('  npm install', 'cyan');
    print('  npm run dev', 'cyan');
    if (!options.github) {
        print('\nTo create a GitHub repository:', 'dim');
        print(`  dotdo init ${name} --github`, 'dim');
    }
    print(`\nDocumentation: https://github.com/dot-do/rpc`, 'dim');
}
//# sourceMappingURL=init.js.map