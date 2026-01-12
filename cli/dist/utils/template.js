/**
 * Template processing utilities for .do domain repo scaffolding
 */
import { readdir, readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
/**
 * Generate all naming conventions from a base name
 */
export function generateNamingConventions(baseName, description) {
    const name = baseName.toLowerCase();
    const Name = name.charAt(0).toUpperCase() + name.slice(1);
    return {
        name,
        Name,
        NAME: name.toUpperCase(),
        'name-do': `${name}-do`,
        name_do: `${name}_do`,
        'name.do': `${name}.do`,
        description: description ?? `${Name} SDK for the DotDo platform`,
    };
}
/**
 * Replace all template placeholders in content
 */
export function replacePlaceholders(content, conventions) {
    let result = content;
    // Replace in order from most specific to least specific
    // to avoid partial matches
    result = result.replace(/\{\{description\}\}/g, conventions['description']);
    result = result.replace(/\{\{name\.do\}\}/g, conventions['name.do']);
    result = result.replace(/\{\{name-do\}\}/g, conventions['name-do']);
    result = result.replace(/\{\{name_do\}\}/g, conventions['name_do']);
    result = result.replace(/\{\{NAME\}\}/g, conventions['NAME']);
    result = result.replace(/\{\{Name\}\}/g, conventions['Name']);
    result = result.replace(/\{\{name\}\}/g, conventions['name']);
    return result;
}
/**
 * Replace placeholders in file/directory paths
 * Handles both {{name}} style in file contents and literal {{name}}_do in directory names
 */
export function replacePathPlaceholders(path, conventions) {
    let result = path;
    // Replace double-brace placeholders (from file names that might have them)
    result = result.replace(/\{\{name\.do\}\}/g, conventions['name.do']);
    result = result.replace(/\{\{name-do\}\}/g, conventions['name-do']);
    result = result.replace(/\{\{name_do\}\}/g, conventions['name_do']);
    result = result.replace(/\{\{NAME\}\}/g, conventions['NAME']);
    result = result.replace(/\{\{Name\}\}/g, conventions['Name']);
    result = result.replace(/\{\{name\}\}/g, conventions['name']);
    return result;
}
/**
 * Check if a file is binary (should not be processed for placeholders)
 */
function isBinaryFile(filename) {
    const binaryExtensions = [
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.svg',
        '.woff', '.woff2', '.ttf', '.eot',
        '.zip', '.tar', '.gz', '.br',
        '.pdf', '.doc', '.docx',
        '.lock',
    ];
    return binaryExtensions.some(ext => filename.endsWith(ext));
}
/**
 * Get the template directory path
 */
export function getTemplateDir() {
    // When running from dist/, template is at ../template
    // When running from source, template is at ../../template
    const distTemplate = join(__dirname, '..', '..', 'template');
    const srcTemplate = join(__dirname, '..', '..', '..', 'template');
    // Try dist path first (production), then src path (development)
    return distTemplate;
}
/**
 * Recursively get all files in a directory
 */
async function getAllFiles(dir, baseDir = dir) {
    const files = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            // Skip node_modules, .git, etc.
            if (entry.name === 'node_modules' || entry.name === '.git') {
                continue;
            }
            files.push(...await getAllFiles(fullPath, baseDir));
        }
        else {
            files.push(relative(baseDir, fullPath));
        }
    }
    return files;
}
/**
 * Copy and process template to target directory
 */
export async function processTemplate(templateDir, targetDir, conventions) {
    const processedFiles = [];
    const files = await getAllFiles(templateDir);
    for (const file of files) {
        const sourcePath = join(templateDir, file);
        // Replace placeholders in filename/path
        const processedPath = replacePathPlaceholders(file, conventions);
        const targetPath = join(targetDir, processedPath);
        // Ensure directory exists
        await mkdir(dirname(targetPath), { recursive: true });
        if (isBinaryFile(file)) {
            // Copy binary files directly
            await copyFile(sourcePath, targetPath);
        }
        else {
            // Read, process, and write text files
            const content = await readFile(sourcePath, 'utf-8');
            const processedContent = replacePlaceholders(content, conventions);
            await writeFile(targetPath, processedContent, 'utf-8');
        }
        processedFiles.push(processedPath);
    }
    return processedFiles;
}
/**
 * Check if directory exists and is not empty
 */
export async function directoryExists(dir) {
    try {
        const stats = await stat(dir);
        if (!stats.isDirectory()) {
            return false;
        }
        const entries = await readdir(dir);
        return entries.length > 0;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=template.js.map