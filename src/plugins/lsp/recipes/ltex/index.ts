// src/plugins/lsp/recipes/ltex/index.ts
import type { Recipe } from '../../../../plugin-host/types';
import { LSP_TYPE, type LspRecipeModule } from '../../shared';
import type { LspTypeConfig } from '../../types';

const VERSION = '18.7.0';
const BASE =
    `https://github.com/ltex-plus/ltex-ls-plus/releases/download/${VERSION}`;
const DIR = `ltex-ls-plus-${VERSION}`;
const IMAGE = 'chelys/ltex-ls-plus:local';

const icon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>';

const archiveFor = (os: string): string =>
    os === 'windows'
        ? `${DIR}-windows-x64.zip`
        : `${DIR}-${os}-x64.tar.gz`;

const extractStep = (os: string) =>
    os === 'windows'
        ? { label: 'Extract archive', command: 'tar', args: ['-xf', archiveFor(os)] }
        : { label: 'Extract archive', command: 'tar', args: ['-xzf', archiveFor(os)] };

const platformPipeline = (os: string) => ({
    installSteps: [
        {
            label: 'Download LTeX LS Plus',
            command: 'curl',
            args: ['-fL', '-o', archiveFor(os), `${BASE}/${archiveFor(os)}`],
        },
        extractStep(os),
        {
            label: 'Install WebSocket proxy',
            command: 'cargo',
            args: ['install', 'lsp-ws-proxy', '--locked'],
        },
    ],
    runCommand: {
        command: 'lsp-ws-proxy',
        args: [
            '-l',
            '127.0.0.1:7020',
            '--',
            os === 'windows'
                ? `./${DIR}/bin/ltex-ls-plus.bat`
                : `./${DIR}/bin/ltex-ls-plus`,
        ],
    },
});

const clientConfig = JSON.stringify({
    rootUri: 'file:///',
    workspaceFolders: [],
    capabilities: {
        workspace: { configuration: true },
        window: { workDoneProgress: false },
    },
    initializationOptions: {
        ltex: {
            language: 'en-US',
            additionalRules: { motherTongue: '' },
            dictionary: {},
            disabledRules: {},
            enabledRules: {},
        },
    },
});

const typeConfig: LspTypeConfig = {
    configId: 'ltex-ls',
    fileExtensions: ['tex', 'latex', 'typ', 'typst', 'bib', 'md', 'markdown'],
    languageIdMap: {
        tex: 'latex',
        latex: 'latex',
        typ: 'typst',
        typst: 'typst',
        bib: 'bibtex',
        md: 'markdown',
        markdown: 'markdown',
    },
    transportUrl: 'ws://localhost:7020',
    contentLength: false,
    clientConfig,
};

const dockerfile = [
    'FROM eclipse-temurin:21-jre',
    'WORKDIR /opt',
    `COPY ${DIR} /opt/${DIR}`,
    'COPY lsp-ws-proxy /usr/local/bin/lsp-ws-proxy',
    'EXPOSE 7020',
    `ENTRYPOINT ["lsp-ws-proxy", "-l", "0.0.0.0:7020", "--", "/opt/${DIR}/bin/ltex-ls-plus"]`,
].join('\n');

const recipe: Recipe = {
    id: 'seed-ltex-ls-plus',
    type: LSP_TYPE,
    name: 'LTeX LS Plus',
    icon,
    notes:
        'Grammar and spell checker for LaTeX, Markdown, and BibTeX. System mode requires Java 21; set JAVA_HOME below if your default java is older. Docker mode bundles its own Java 21.',
    env: {},
    modes: [
        {
            kind: 'system',
            installSteps: platformPipeline('linux').installSteps,
            runCommand: platformPipeline('linux').runCommand,
            platforms: {
                linux: platformPipeline('linux'),
                macos: platformPipeline('macos'),
                windows: platformPipeline('windows'),
            },
        },
        {
            kind: 'docker',
            image: IMAGE,
            buildSteps: [
                {
                    label: 'Download LTeX LS Plus',
                    command: 'curl',
                    args: ['-fL', '-o', archiveFor('linux'), `${BASE}/${archiveFor('linux')}`],
                },
                { label: 'Extract archive', command: 'tar', args: ['-xzf', archiveFor('linux')] },
                {
                    label: 'Build proxy binary',
                    command: 'cargo',
                    args: ['install', 'lsp-ws-proxy', '--locked', '--root', '.'],
                },
                { label: 'Stage proxy binary', command: 'cp', args: ['bin/lsp-ws-proxy', 'lsp-ws-proxy'] },
                {
                    label: 'Write Dockerfile',
                    command: 'sh',
                    args: ['-c', 'printf %s "$0" > Dockerfile.chelys-ltex', dockerfile],
                },
                {
                    label: 'Build image',
                    command: 'docker',
                    args: ['build', '-f', 'Dockerfile.chelys-ltex', '-t', IMAGE, '.'],
                },
            ],
            runArgs: ['-p', '7020:7020'],
        },
        { kind: 'connect' },
    ],
    typeConfig: typeConfig as unknown as Record<string, unknown>,
};

export const ltexModule: LspRecipeModule = { recipe };