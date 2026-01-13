import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'DotDo SDKs',
  description: 'Multi-language SDK for Cap\'n Web RPC with Promise Pipelining',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/rpc-client' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'Languages',
        items: [
          { text: 'TypeScript', link: '/installation/typescript' },
          { text: 'Python', link: '/installation/python' },
          { text: 'Go', link: '/installation/go' },
          { text: 'Rust', link: '/installation/rust' },
          { text: 'Ruby', link: '/installation/ruby' },
          { text: 'Java/Kotlin', link: '/installation/java-kotlin' },
          { text: '.NET (C#/F#)', link: '/installation/dotnet' },
          { text: 'Elixir', link: '/installation/elixir' },
        ]
      },
      {
        text: '0.1.0',
        items: [
          { text: 'Changelog', link: '/changelog' },
          { text: 'GitHub', link: 'https://github.com/dot-do/sdks' },
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Why Cap\'n Web?', link: '/guide/why-capnweb' },
            { text: 'Core Concepts', link: '/guide/core-concepts' },
          ]
        },
        {
          text: 'Fundamentals',
          items: [
            { text: 'Promise Pipelining', link: '/guide/promise-pipelining' },
            { text: 'Error Handling', link: '/guide/error-handling' },
            { text: 'Resource Management', link: '/guide/resource-management' },
            { text: 'Security', link: '/guide/security' },
          ]
        },
        {
          text: 'Advanced',
          items: [
            { text: 'Custom Transports', link: '/guide/custom-transports' },
            { text: 'Workers RPC Interop', link: '/guide/workers-interop' },
          ]
        }
      ],
      '/installation/': [
        {
          text: 'Installation',
          items: [
            { text: 'Overview', link: '/installation/' },
            { text: 'TypeScript', link: '/installation/typescript' },
            { text: 'Python', link: '/installation/python' },
            { text: 'Go', link: '/installation/go' },
            { text: 'Rust', link: '/installation/rust' },
            { text: 'Ruby', link: '/installation/ruby' },
            { text: 'Java/Kotlin', link: '/installation/java-kotlin' },
            { text: '.NET (C#/F#)', link: '/installation/dotnet' },
            { text: 'Swift', link: '/installation/swift' },
            { text: 'Elixir', link: '/installation/elixir' },
            { text: 'Other Languages', link: '/installation/other' },
          ]
        }
      ],
      '/api/': [
        {
          text: 'Core API',
          items: [
            { text: 'RpcClient', link: '/api/rpc-client' },
            { text: 'RpcTarget', link: '/api/rpc-target' },
            { text: 'RpcStub', link: '/api/rpc-stub' },
            { text: 'RpcPromise', link: '/api/rpc-promise' },
          ]
        },
        {
          text: 'Sessions',
          items: [
            { text: 'WebSocket Sessions', link: '/api/websocket-session' },
            { text: 'HTTP Batch Sessions', link: '/api/http-batch-session' },
            { text: 'MessagePort Sessions', link: '/api/messageport-session' },
          ]
        },
        {
          text: 'Types',
          items: [
            { text: 'Serializable Types', link: '/api/serializable-types' },
            { text: 'RpcTransport', link: '/api/rpc-transport' },
          ]
        }
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Basic Client/Server', link: '/examples/basic' },
            { text: 'Authentication', link: '/examples/authentication' },
            { text: 'Promise Pipelining', link: '/examples/pipelining' },
            { text: 'Bidirectional RPC', link: '/examples/bidirectional' },
            { text: 'Cloudflare Workers', link: '/examples/cloudflare-workers' },
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/dot-do/sdks' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2024-present DotDo'
    },

    search: {
      provider: 'local'
    },

    editLink: {
      pattern: 'https://github.com/dot-do/sdks/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    }
  }
})
