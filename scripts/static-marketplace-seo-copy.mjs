export const staticSeoCopy = {
  '/': {
    zh: {
      title: 'DSH STORE｜DSH Desktop 插件商城与 DSH 插件开发',
      description: 'DSH STORE 是 DeepSeek Harness 第三方插件商城，适配 DSH Desktop。浏览插件、核对固定来源与权限；安装资格由官方管理器检查。',
      text: {
        'hero.title1': '让 DSH，',
        'hero.title2': '拥有更多可能。',
        'hero.lead': '发现插件、核对来源与权限，并通过 DSH Desktop 内的插件商城查看和管理已审核条目。安装兼容性由官方 Desktop 插件管理器校验；客户端适配标识不作为安装门槛。',
      },
    },
    en: {
      title: 'DSH STORE | DSH Desktop Plugin Marketplace',
      description: 'Third-party DeepSeek Harness plugin marketplace for DSH Desktop. Browse plugins, review pinned sources and permissions; DSH checks installation eligibility.',
      text: {
        'hero.title1': 'Make DSH',
        'hero.title2': 'more capable.',
        'hero.lead': 'Discover plugins, review sources and permissions in the DSH Desktop marketplace. Approved entries and user-confirmed blocked fixed sources go to the official manager, which returns the install result; client-adaptation labels do not gate installation.',
      },
    },
  },
  '/plugins/': {
    zh: {
      title: 'DSH 插件目录与 Desktop 商城｜DSH STORE',
      description: '浏览 DSH 插件与 DSH Desktop 商城说明。核对固定源码、权限与收录状态；安装结果由 DSH 官方管理器返回。',
      text: {
        'directory.title1': '按分类发现，',
        'directory.title2': '浏览全部已知插件。',
        'directory.lead': '本网页是只读插件发现目录。DSH Desktop 内的插件商城会把已审核固定来源条目交给官方插件管理器校验；客户端适配标识只描述专属 UI 证据，不是安装门槛，Catalog blocked 条目保留 Store 审核建议；用户确认后可交由 DSH Desktop 检查，安装结果由 DSH 返回。',
      },
    },
    en: {
      title: 'DSH Plugin Catalog and Desktop Marketplace | DSH STORE',
      description: 'Browse DeepSeek Harness plugins in DSH STORE. Review pinned sources and listing status; DSH Desktop checks installation eligibility.',
      text: {
        'directory.title1': 'Browse by category.',
        'directory.title2': 'See every known record.',
        'directory.lead': 'This public website is a read-only discovery directory. Inside DSH Desktop, approved fixed-source entries are passed to its official plugin manager for compatibility checks; client-adaptation labels describe optional UI evidence and do not gate installation. Catalog-blocked entries show Store review advice and can be submitted from DSH Desktop after confirmation; DSH returns the result.',
      },
    },
  },
  '/standards/': {
    zh: {
      title: '插件收录标准｜DSH STORE',
      description: 'DSH STORE 收录标准：候选发现、低风险自动准入、固定源码专项审阅、精确版本兼容性与可追溯的误报复核。',
      text: {
        'hero.title1': '收录前，',
        'hero.title2': '先把标准公开。',
        'hero.lead': 'DSH STORE 从公开 GitHub 项目中发现候选，但“被发现”不等于“已收录”。只有固定来源、结构、权限、兼容性与证据门槛逐项成立，插件才可能进入受保护的 Catalog。',
      },
    },
    en: {
      title: 'Plugin Listing Standards | DSH STORE',
      description: 'DSH STORE listing standards: discovery, low-risk automatic admission, fixed-source review, exact host compatibility, and traceable false-positive review.',
      text: {
        'hero.title1': 'Before listing,',
        'hero.title2': 'publish the standard.',
        'hero.lead': 'DSH STORE discovers candidates from public GitHub projects, but discovery is not listing. A plugin can enter the guarded Catalog only after its pinned source, structure, permissions, compatibility, and evidence gates hold together.',
      },
    },
  },
  '/dsh-plugins/': {
    zh: {
      title: 'DSH 插件指南｜DeepSeek Harness 插件商城 | DSH STORE',
      description: 'DSH 插件指南：通过 DSH STORE 发现、核对、安装和开发 DeepSeek Harness 插件，先检查固定来源、权限与可恢复的接入步骤。',
      text: {
        'guide.title1': 'DSH 插件，',
        'guide.title2': '先理解，再接入。',
        'guide.lead': 'DSH STORE 是面向 DeepSeek Harness（DSH）的第三方插件商城。这里把 DSH 插件的发现、来源核对、权限判断、固定提交安装与开发路径放在一页，方便用户和 AI Agent 快速找到可信的下一步。',
      },
    },
    en: {
      title: 'DSH Plugin Guide | DeepSeek Harness | DSH STORE',
      description: 'Discover, review, and build DeepSeek Harness plugins with DSH STORE. Check pinned sources, permissions, compatibility, and access steps.',
      text: {
        'guide.title1': 'DSH plugins,',
        'guide.title2': 'understand before connecting.',
        'guide.lead': 'DSH STORE is a third-party marketplace for DeepSeek Harness (DSH) plugins. This guide brings plugin discovery, source checks, permission review, pinned-commit installation, and development paths together so users and AI agents can find a clear next step.',
      },
    },
  },
  '/build/': {
    zh: {
      title: 'DSH Desktop 插件开发工作流｜DSH STORE Build Lab',
      description: '用 build-dsh-plugin 为 DSH Web 和官方 Desktop 开发插件，查看构建步骤、风险边界与验收要求。',
      text: {
        'hero.title1': '用三个答案，',
        'hero.title2': '启动一个 DSH 插件。',
        'hero.lead': '把自然语言 Brief 转换为标准 Bundle、风险边界、源码、测试和证据门槛。可指定 DSH Web、官方 Desktop 或两者；是否提供 Desktop 专属界面单独标记，不决定安装资格。',
      },
    },
    en: {
      title: 'Build DSH Desktop Plugins | DSH STORE Build Lab',
      description: 'Build DSH Web and official Desktop plugins with build-dsh-plugin. Define the brief, target host, risk boundaries, and acceptance evidence.',
      text: {
        'hero.title1': 'Three answers',
        'hero.title2': 'start a DSH plugin.',
        'hero.lead': 'Turn a natural-language brief into a standard Bundle, risk boundary, source project, tests, and evidence gates. Choose DSH Web, official Desktop, or both. Desktop-specific UI adaptation is a separate label, not an install gate.',
      },
    },
  },
  '/faq/': {
    zh: {
      title: '常见问题｜DSH STORE',
      description: 'DSH STORE 常见问题：了解 DeepSeek Harness 插件商城、插件安装、安全边界、目录来源、插件提交、开发方式与隐私说明。',
      text: {
        'hero.title1': '常见问题，',
        'hero.title2': '先把边界说清楚。',
        'hero.lead': '从产品定位、插件安装到安全、开发和隐私，集中回答使用 DSH STORE 前最需要确认的问题。',
      },
    },
    en: {
      title: 'Frequently Asked Questions | DSH STORE',
      description: 'DSH STORE FAQ covering the DeepSeek Harness plugin marketplace, installation, safety boundaries, catalog sources, submissions, development, and privacy.',
      text: {
        'hero.title1': 'Questions answered.',
        'hero.title2': 'Boundaries made clear.',
        'hero.lead': 'Clear answers about DSH STORE, plugin installation, safety, development, and privacy before you make a decision.',
      },
    },
  },
  '/about/': {
    zh: {
      title: '关于我们｜DSH STORE',
      description: '了解 DSH STORE 插件商城与 DSH.STORE 品牌：面向 DeepSeek Harness 的可信第三方插件发现、开发与安全接入入口。',
      text: {
        'hero.title1': '关于',
        'hero.lead': 'DSH STORE 是面向 DeepSeek Harness 的可信第三方插件商城。我们让插件发现更直观、信息判断更清楚、开发与接入更有边界。',
      },
    },
    en: {
      title: 'About Us | DSH STORE',
      description: 'Meet DSH STORE and the DSH.STORE brand: a trusted third-party marketplace for discovering, building, and safely connecting DeepSeek Harness plugins.',
      text: {
        'hero.title1': 'About',
        'hero.lead': 'DSH STORE is a trusted third-party marketplace for DeepSeek Harness plugins. We make discovery more direct, decisions clearer, and plugin development and access better bounded.',
      },
    },
  },
  '/community/': {
    zh: {
      title: '社区与开发者｜DSH STORE',
      description: '加入 DSH STORE 插件生态：开发 DeepSeek Harness 插件、提交项目到公开 Catalog，或通过现有渠道反馈与交流。',
      text: {
        'hero.title1': '让插件生态，',
        'hero.title2': '由开发者和用户共同推动。',
        'hero.lead': '从构建标准插件、提交固定来源，到反馈问题与改进体验，每个入口都清晰可循。',
      },
    },
    en: {
      title: 'Community & Developers | DSH STORE',
      description: 'Join the DSH STORE ecosystem: build DeepSeek Harness plugins, submit projects to the public Catalog, or share feedback through established channels.',
      text: {
        'hero.title1': 'A plugin ecosystem,',
        'hero.title2': 'built by developers and users.',
        'hero.lead': 'Build standard plugins, submit pinned sources, share feedback, and improve the experience through clear paths.',
      },
    },
  },
  '/rankings/': {
    zh: {
      title: '插件榜单 | DSH STORE',
      description: '探索 DSH 插件热门榜、收录榜、推荐榜和必装榜：按 GitHub 星标排名，明确展示收录状态与未收录原因。',
      text: {
        'hero.title': '值得发现的插件，在这里。',
        'hero.lead': '已收录与未收录，一起看热度；是否收录，每项清楚标记。',
      },
    },
    en: {
      title: 'Plugin Charts | DSH STORE',
      description: 'Explore DSH plugin charts by GitHub stars, category, and listing status. Rankings show Store status; they are not security reviews.',
      text: {
        'hero.title': 'Find your next great plugin.',
        'hero.lead': 'Explore listed and unlisted projects together. Every entry shows its Store status and, when unlisted, the reason.',
      },
    },
  },
}
