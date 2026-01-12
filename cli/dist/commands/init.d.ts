/**
 * Init command - scaffold a new .do domain repo from template
 */
export interface InitOptions {
    /** Target directory (default: ./<name>.do) */
    dir?: string;
    /** Create GitHub repository */
    github?: boolean;
    /** GitHub organization (default: dot-do) */
    org?: string;
    /** Make the GitHub repo private */
    private?: boolean;
    /** Project description */
    description?: string;
}
/**
 * Execute the init command
 */
export declare function init(name: string, options?: InitOptions): Promise<void>;
//# sourceMappingURL=init.d.ts.map