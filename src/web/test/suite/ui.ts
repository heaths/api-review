// Imports mocha for the browser, defining the `mocha` global.
require('mocha/mocha');

export function run(): Promise<void> {

  return new Promise((c, e) => {
    mocha.setup({
      ui: 'tdd',
      reporter: undefined
    });

    const importAll = (r: __WebpackModuleApi.RequireContext) => r.keys()
      .filter(key => key.includes('.ui.test'))
      .forEach(r);
    importAll(require.context('.', true, /\.test$/));

    try {
      // Run the mocha test
      mocha.run(failures => {
        if (failures > 0) {
          e(new Error(`${failures} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      console.error(err);
      e(err);
    }
  });
}
