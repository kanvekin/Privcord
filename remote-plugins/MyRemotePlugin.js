(function(){
  // Minimal example: adds a console log during start
  const plugin = {
    name: "MyRemotePlugin",
    description: "Example remote plugin loaded at runtime",
    authors: [],
    start() { console.log("MyRemotePlugin started"); },
    stop() { console.log("MyRemotePlugin stopped"); }
  };
  window.PrivcordRemote.register(plugin);
})();
