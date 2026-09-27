function createInMemoryMonitorRepository() {
  const monitors = [];
  let nextMonitorId = 1;

  return {
    async create({ name, url }) {
      if (monitors.some((monitor) => monitor.url === url)) {
        const error = new Error('Duplicated monitor URL');
        error.code = '23505';
        throw error;
      }

      const monitor = {
        id: nextMonitorId,
        name,
        url,
        enabled: true,
        createdAt: new Date().toISOString(),
        latestCheck: null,
      };

      nextMonitorId += 1;
      monitors.push(monitor);
      return monitor;
    },

    async list() {
      return monitors;
    },
  };
}

module.exports = createInMemoryMonitorRepository;
