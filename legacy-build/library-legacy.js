// Linked with --js-library after the system libraries, so it replaces the embind helper of the same name.
addToLibrary({
  // Function.prototype.name is not configurable before Chrome 43, Firefox 38 and Safari 10, where
  // Object.defineProperty throws inside a promise chain the glue never catches. The name is cosmetic.
  $createNamedFunction: (name, func) => {
    try {
      return Object.defineProperty(func, 'name', { value: name })
    } catch (error) {
      return func
    }
  }
})
