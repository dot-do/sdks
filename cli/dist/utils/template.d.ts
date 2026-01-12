/**
 * Template processing utilities for .do domain repo scaffolding
 */
/**
 * Naming conventions for template placeholders
 */
export interface NamingConventions {
    /** Lowercase: mongo */
    name: string;
    /** Capitalized: Mongo */
    Name: string;
    /** Uppercase: MONGO */
    NAME: string;
    /** Hyphenated with -do: mongo-do */
    'name-do': string;
    /** Underscored with _do: mongo_do */
    name_do: string;
    /** Dotted: mongo.do */
    'name.do': string;
    /** Description for the project */
    description: string;
}
/**
 * Generate all naming conventions from a base name
 */
export declare function generateNamingConventions(baseName: string, description?: string): NamingConventions;
/**
 * Replace all template placeholders in content
 */
export declare function replacePlaceholders(content: string, conventions: NamingConventions): string;
/**
 * Replace placeholders in file/directory paths
 * Handles both {{name}} style in file contents and literal {{name}}_do in directory names
 */
export declare function replacePathPlaceholders(path: string, conventions: NamingConventions): string;
/**
 * Get the template directory path
 */
export declare function getTemplateDir(): string;
/**
 * Copy and process template to target directory
 */
export declare function processTemplate(templateDir: string, targetDir: string, conventions: NamingConventions): Promise<string[]>;
/**
 * Check if directory exists and is not empty
 */
export declare function directoryExists(dir: string): Promise<boolean>;
//# sourceMappingURL=template.d.ts.map