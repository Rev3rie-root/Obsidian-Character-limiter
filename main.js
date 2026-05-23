const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const DEFAULT_SETTINGS = {
    characterLimit: 1300,
    countMethod: 'raw', // 'raw' or 'stripped' (removes markdown)
    showWarningAt: 90 // percentage (90% = warning at 1170/1300)
};

module.exports = class CharacterLimiterPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        
        this.addSettingTab(new CharacterLimiterSettingTab(this.app, this));
        
        // Track files created while plugin is active
        this.trackedFiles = new Set();
        
        // Monitor new file creation
        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file.extension === 'md') {
                    this.trackedFiles.add(file.path);
                }
            })
        );
        
        // Monitor editing in real-time
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile || !this.trackedFiles.has(activeFile.path)) {
                    return; // Ignore old files
                }
                
                this.enforceLimit(editor);
            })
        );
        
        // Add status bar indicator
        this.statusBarEl = this.addStatusBarItem();
        this.updateStatusBar();
        
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                this.updateStatusBar();
            })
        );
    }
    
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }
    
    async saveSettings() {
        await this.saveData(this.settings);
    }
    
    removeFrontmatter(text) {
        if (!text.startsWith('---')) return text;
        const lines = text.split('\n');
        let endIndex = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trimEnd() === '---') {
                endIndex = i;
                break;
            }
        }
        return endIndex !== -1 ? lines.slice(endIndex + 1).join('\n') : text;
    }
    
    stripMarkdown(text) {
        let stripped = text;
        stripped = stripped.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1");
        stripped = stripped.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
        stripped = stripped.replace(/\[\[([^\]]+)\]\]/g, "$1");
        stripped = stripped.replace(/!\[([^\]]*)\]\([^\)]+\)/g, "");
        stripped = stripped.replace(/(\*\*|__)(.*?)\1/g, "$2");
        stripped = stripped.replace(/(\*|_)(.*?)\1/g, "$2");
        stripped = stripped.replace(/~~(.*?)~~/g, "$1");
        stripped = stripped.replace(/==(.*?)==/g, "$1");
        stripped = stripped.replace(/^#{1,6}\s+/gm, "");
        stripped = stripped.replace(/^>\s*/gm, "");
        stripped = stripped.replace(/^[\s]*[-*+]\s+/gm, "");
        stripped = stripped.replace(/^[\s]*\d+\.\s+/gm, "");
        stripped = stripped.replace(/```[\s\S]*?```/g, "");
        stripped = stripped.replace(/`[^`]+`/g, "");
        return stripped;
    }
    
    getCharacterCount(text) {
        const cleaned = this.removeFrontmatter(text);
        
        if (this.settings.countMethod === 'stripped') {
            return this.stripMarkdown(cleaned).length;
        }
        return cleaned.length;
    }
    
    enforceLimit(editor) {
        const text = editor.getValue();
        const count = this.getCharacterCount(text);
        const limit = this.settings.characterLimit;
        
        if (count > limit) {
            // Block the change by reverting
            const cleaned = this.removeFrontmatter(text);
            const frontmatterLength = text.length - cleaned.length;
            
            // Trim content back to limit
            const trimmed = cleaned.substring(0, limit);
            const frontmatter = text.substring(0, frontmatterLength);
            
            editor.setValue(frontmatter + trimmed);
            
            new Notice(`Character limit reached (${limit})`);
        }
        
        this.updateStatusBar();
    }
    
    updateStatusBar() {
        const activeFile = this.app.workspace.getActiveFile();
        
        if (!activeFile || !this.trackedFiles.has(activeFile.path)) {
            this.statusBarEl.setText('');
            return;
        }
        
        const editor = this.app.workspace.activeEditor?.editor;
        if (!editor) {
            this.statusBarEl.setText('');
            return;
        }
        
        const text = editor.getValue();
        const count = this.getCharacterCount(text);
        const limit = this.settings.characterLimit;
        const percentage = Math.round((count / limit) * 100);
        
        let statusText = `${count}/${limit} chars`;
        
        if (percentage >= this.settings.showWarningAt) {
            statusText += ' ⚠️';
        }
        
        this.statusBarEl.setText(statusText);
    }
    
    onunload() {
        if (this.statusBarEl) {
            this.statusBarEl.remove();
        }
    }
};

class CharacterLimiterSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    
    display() {
        const { containerEl } = this;
        containerEl.empty();
        
        containerEl.createEl('h2', { text: 'Character Limiter Settings' });
        
        new Setting(containerEl)
            .setName('Character limit')
            .setDesc('Maximum characters for new files (ignores frontmatter)')
            .addText(text => text
                .setPlaceholder('1300')
                .setValue(String(this.plugin.settings.characterLimit))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        this.plugin.settings.characterLimit = num;
                        await this.plugin.saveSettings();
                    }
                }));
        
        new Setting(containerEl)
            .setName('Count method')
            .setDesc('Count raw text or strip markdown formatting first')
            .addDropdown(dropdown => dropdown
                .addOption('raw', 'Raw text (includes markdown)')
                .addOption('stripped', 'Stripped (removes markdown)')
                .setValue(this.plugin.settings.countMethod)
                .onChange(async (value) => {
                    this.plugin.settings.countMethod = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Warning threshold')
            .setDesc('Show warning icon at this percentage (e.g., 90 = warning at 90%)')
            .addText(text => text
                .setPlaceholder('90')
                .setValue(String(this.plugin.settings.showWarningAt))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0 && num <= 100) {
                        this.plugin.settings.showWarningAt = num;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}
