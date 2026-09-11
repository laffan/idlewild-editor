# Utils

Phaser's collection of utility functions and helper classes that provide various functionalities designed simplify common tasks.

## Phaser.Utils.Array[​](#phaserutilsarray "Direct link to Phaser.Utils.Array")

Provides a variety of utility methods for working with arrays.

### Adding elements[​](#adding-elements "Direct link to Adding elements")

*   Add an item to an array.
    
    ```
    Add(array, item, [limit], [callback], [context]);
    ```
    
    *   `item` : The item, or array of items, to add to the array. Each item must be unique within the array.
    *   Optional `limit` : Optional limit which caps the size of the array.
    *   Optional `callback` : A callback to be invoked for each item successfully added to the array.
    *   Optional `context` : The context in which the callback is invoked.
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.Add(array, 4); // Adds 4 to the array
    console.log(array); // [1, 2, 3, 4]
    ```
    
*   Add an item to the array at the specified index.
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.AddAt(array, 4, 1); // Inserts 4 at index 1
    console.log(array); // [1, 4, 2, 3]
    ```
    

### Removing elements[​](#removing-elements "Direct link to Removing elements")

*   Remove the first occurrence of a specified item from an array.
    
    ```
    Remove(array, item, [callback], [context]);
    ```
    
    *   `item` : The item, or array of items, to be removed from the array.
    *   Optional `callback` : A callback to be invoked for each item successfully removed from the array.
    *   Optional `context` : The context in which the callback is invoked.
    
    Example
    
    ```
    let array = [1, 2, 3, 2];
    Phaser.Utils.Array.Remove(array, 2); // Removes the first occurrence of 2
    console.log(array); // [1, 3, 2]
    ```
    
*   Remove an element at the specified index.
    
    ```
    RemoveAt(array, index, [callback], [context]);
    ```
    
    *   `index` : The array index to remove the item from. The index must be in bounds or it will throw an error.
    *   Optional `callback` : A callback to be invoked for the item removed from the array.
    *   Optional `context` : The context in which the callback is invoked.
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.RemoveAt(array, 1); // Removes the element at index 1
    console.log(array); // [1, 3]
    ```
    
*   Removes elements between `startIndex` and `endIndex` (inclusive).
    
    ```
    RemoveBetween(array, startIndex, endIndex, [callback], [context]);
    ```
    
    *   `startIndex` : Includes the start index to removing from.
    *   `endIndex` : Excludes the end index to remove to.
    *   `callback` : A callback to be invoked for the item removed from the array.
    *   `context` : The context in which the callback is invoked.
    
    Example
    
    ```
    let array = [1, 2, 3, 4, 5];
    Phaser.Utils.Array.RemoveBetween(array, 1, 3); // Removes elements from index 1 to 3
    console.log(array); // [1, 4, 5]
    ```
    
*   Removes and returns one random element from the array.
    
    ```
    RemoveRandomElement(array, [start], [length]);
    ```
    
    *   `start` : The array index to start the search from. Defaults to 0.
    *   `length` : Optional restriction on the number of elements to randomly select from. Defaults to array length.
    
    Example
    
    ```
    let array = [1, 2, 3];
    let randomItem = Phaser.Utils.Array.RemoveRandomElement(array);
    console.log(randomItem); // Random item removed (e.g., 2)
    console.log(array); // [1, 3]
    ```
    
*   Remove one element from the array at the specified index.
    
    ```
    SpliceOne(array, index);
    ```
    
    *   `index` : The index of the item which should be spliced.
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.SpliceOne(array, 1); // Removes element at index 1
    console.log(array); // [1, 3]
    ```
    

### Moving elements[​](#moving-elements "Direct link to Moving elements")

*   Moves the specified item to a new index.
    
    ```
    MoveTo(array, item, index);
    ```
    
    *   `item` : The element to move.
    *   `index` : The new index that the element will be moved to.
    
    Example
    
    ```
    let array = [1, 2, 3, 4];
    Phaser.Utils.Array.MoveTo(array, 3, 1); // Moves 3 to index 1
    console.log(array); // [1, 3, 2, 4]
    ```
    
*   Moves the specified item up by one index in the array.
    
    ```
    MoveUp(array, item);
    ```
    
    *   `item` : The element to move up the array.
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.MoveUp(array, 2); // Moves 2 up one index
    console.log(array); // [1, 3, 2]
    ```
    
*   Moves the specified item down by one index in the array.
    
    ```
    MoveDown(array, item);
    ```
    
    *   `item` : The element to move down the array.
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.MoveDown(array, 2); // Moves 2 down one index
    console.log(array); // [2, 1, 3]
    ```
    
*   Move item one position above `baseElement` or one index after `baseElement`. If the given element is already above `baseElement`, it isn't moved.
    
    ```
    MoveAbove(array, item, baseElement);
    ```
    
    *   `item` : The element to move above base element.
    *   `baseElement` : The base element.
    
    Example
    
    ```
    let array = [1, 2, 3, 4];
    Phaser.Utils.Array.MoveAbove(array, 1, 3); // Moves 1 above 3
    console.log(array); // [2, 3, 4, 1]
    ```
    
*   Move item one position below `baseElement` or one index after `baseElement`. If the given element is already above `baseElement`, it isn't moved.
    
    ```
    MoveBelow(array, item, baseElement);
    ```
    
    *   `item` : The element to move below base element.
    *   `baseElement` : The base element.
    
    Example
    
    ```
    let array = [1, 2, 3, 4];
    Phaser.Utils.Array.MoveBelow(array, 4, 2); // Moves 4 below 2
    console.log(array); // [1, 4, 2, 3]
    ```
    

### Sorting & Shuffling[​](#sorting--shuffling "Direct link to Sorting & Shuffling")

Functions for sorting and shuffling arrays.

*   Shuffles the elements of the array randomly.
    
    ```
    SortByDigits(array);
    ```
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.Shuffle(array); // Randomly shuffles the array
    console.log(array); // Random order (e.g., [3, 1, 2])
    ```
    
*   Sorts an array of strings by the numeric part of the strings, ignoring any non-numeric characters.
    
    ```
    SortByDigits(array);
    ```
    
    Example
    
    ```
    let array = ["item20", "item5", "item100", "item1"];
    Phaser.Utils.Array.SortByDigits(array);
    console.log(array); // ['item1', 'item5', 'item20', 'item100']
    ```
    
*   A stable sort that maintains the relative order of equal elements.
    
    ```
    StableSort(array, compare);
    ```
    
    *   `compare` : The comparison function.
    
    Example
    
    ```
    let array = [5, 2, 9, 1];
    Phaser.Utils.Array.StableSort(array, (a, b) => a - b); // Sorts array
    console.log(array); // [1, 2, 5, 9]
    ```
    
*   Rearrange an array so that all items in the \[left, k\] range are smaller than all items in \[k, right\]; The k-th element will have the (k - left + 1)th smallest value in \[left, right\].
    
    ```
    QuickSelect(array, k, [left], [right], [compare]);
    ```
    
    *   `k` : The k-th element index.
    *   `left` : The index of the left part of the range.
    *   `right` : The index of the right part of the range.
    *   `compare` : An optional comparison function. Is passed two elements and should return 0, 1 or -1.
    
    Example
    
    ```
    var array = [10, 4, 5, 8, 6, 11, 26];
    Phaser.Utils.Array.QuickSelect(array, 2);
    console.log(array); // [ 4, 5, 6, 8, 10, 11, 26 ]
    ```
    

### Retrieving Elements[​](#retrieving-elements "Direct link to Retrieving Elements")

Methods for retrieving elements based on different conditions.

*   Returns the first element in the array with optional matching criterias using `property` and `value`. If no matching element is found, it returns `null`.
    
    ```
    GetFirst(array, [property], [value], [startIndex], [endIndex]);
    ```
    
    *   `property` : The property to test on each array element.
    *   `value` : The value to test the property against. Must pass a strict (===) comparison check.
    *   `startIndex` : Includes the optional start index to search from. Defaults to 0.
    *   `endIndex` : Excludes the optional end index to search up to. Defaults to `array` length.
    
    Example 1: Get first item matching a property with a specific value
    
    ```
    var array = [
      { name: "apple", color: "red" },
      { name: "banana", color: "yellow" },
      { name: "grape", color: "purple" },
      { name: "strawberry", color: "red" },
      { name: "squash", color: "yellow" },
      { name: "eggplant", color: "purple" },
    ];
    
    var result = Phaser.Utils.Array.GetFirst(array, "color", "yellow");
    console.log(result); // Output: { name: 'banana', color: 'yellow' }
    ```
    
    Example 2: Get first item matching a property, regardless of value
    
    ```
    var array = [
      { name: "apple" },
      { name: "banana", color: "yellow" },
      { name: "grape", color: "purple" },
      { name: "strawberry", color: "red" },
      { name: "squash", color: "yellow" },
      { name: "eggplant", color: "purple" },
    ];
    
    var result = Phaser.Utils.Array.GetFirst(array, "color");
    console.log(result); // Output: { name: 'banana', color: 'yellow' }
    ```
    
    Example 3: Get first item without specifying a property
    
    ```
    var array = [
      { name: "apple", color: "red" },
      { name: "banana", color: "yellow" },
      { name: "grape", color: "purple" },
      { name: "strawberry", color: "red" },
      { name: "squash", color: "yellow" },
      { name: "eggplant", color: "purple" },
    ];
    
    var result = Phaser.Utils.Array.GetFirst(array);
    console.log(result); // Output: { name: 'apple', color: 'red' }
    ```
    
    Example 4: Get first item matching a property and index including `startIndex` and excluding `endIndex`.
    
    ```
    var array = [
      { name: "apple", color: "red" },
      { name: "banana", color: "yellow" },
      { name: "grape", color: "purple" },
      { name: "strawberry", color: "red" },
      { name: "squash", color: "yellow" },
      { name: "eggplant", color: "purple" },
    ];
    
    var result = Phaser.Utils.Array.GetFirst(array, "color", "purple", 3, 6);
    console.log(result); // Output: { name: 'eggplant', color: 'purple' }
    ```
    
*   Returns a random element from the array.
    
    ```
    GetRandom(array, [startIndex], [length]);
    ```
    
    *   `startIndex` : An optional start index. Defaults to 0.
    *   `length` : An optional length, the total number of elements (from the startIndex) to choose from. Defaults to the `array` length.
    
    Example 1: Get a random element
    
    ```
    let array = [1, 2, 3, 4, 5];
    let randomItem = Phaser.Utils.Array.GetRandom(array);
    console.log(randomItem); // Output: 2
    ```
    
    Example 2: Get a random element from a subarray
    
    ```
    let array = [1, 2, 3, 4, 5];
    let randomItem = Phaser.Utils.Array.GetRandom(array, 2, 2); // Consider elements from index 2 to index 3
    console.log(randomItem); // Output: 3 or 4
    ```
    
*   Finds the closest `value` to the given number in a sorted array.
    
    ```
    FindClosestInSorted(value, array, [key]);
    ```
    
    *   `value` : The value to search for in the array.
    *   `array` : The array to search, which must be sorted.
    *   `key` : An optional property key. If specified the array elements property will be checked against value.
    
    Example 1
    
    ```
    let array = [1, 3, 7, 10];
    let closest = Phaser.Utils.Array.FindClosestInSorted(5, array); // Closest to 5
    console.log(closest); // 7
    ```
    
    Example 2: Array of objects
    
    ```
    var array = [
      { id: 1, value: 10 },
      { id: 2, value: 20 },
      { id: 3, value: 30 },
      { id: 4, value: 40 },
    ];
    
    var closest = Phaser.Utils.Array.FindClosestInSorted(35, array, "value");
    console.log(closest); // Output: { id: 4, value: 40 }
    ```
    

* * *

### Array Creation[​](#array-creation "Direct link to Array Creation")

Methods for creating arrays

*   Flatten a multi-dimensional array into a one-dimensional array.
    
    ```
    Flatten(array, [output]);
    ```
    
    *   `output` : An optinal array to hold the results in.
    
    Example
    
    ```
    let array = [
      [1, 2],
      [3, 4],
    ];
    let flat = Phaser.Utils.Array.Flatten(array);
    console.log(flat); // [1, 2, 3, 4]
    ```
    
*   Creates an array with numbers from `start` to `end`.
    
    ```
    NumberArray(start, end, [prefix], [suffix]);
    ```
    
    Example
    
    ```
    let array = Phaser.Utils.Array.NumberArray(1, 5);
    console.log(array); // [1, 2, 3, 4, 5]
    ```
    
*   Creates an array from `start` to `end`, incremented by `step`.
    
    ```
    NumberArrayStep([start], [end], [step]);
    ```
    
    *   `start` : The start of the range.
    *   `end` : The end of the range.
    *   `step` : The value to increment or decrement by.
    
    Example
    
    ```
    let array = Phaser.Utils.Array.NumberArrayStep(1, 10, 2);
    console.log(array); // [1, 3, 5, 7, 9]
    ```
    
*   Create an array with a range of values, based on the given arguments and configuration.
    
    ```
    Range(a, b, [options]);
    ```
    
    *   `options` : A range configuration object. Can contain: `repeat`, `random`, `randomB`, `yoyo`, `max`, `qty`.
        *   `max`: Maximum number of elements to generate. Defaults to 0 (no limit).
        *   `qty`: Number of times to repeat each element from the combination of `a` and `b`. Defaults to 1.
        *   `random`: Shuffle the generated array? Defaults to `false`.
        *   `randomB`: Shuffle `b` before generating the output? Defaults to `false`.
        *   `repeat`: Number of repetitions combining `a` and `b`. Set to `-1` for infinite repetition. Defaults to 0 (no repetition).
        *   `yoyo`: Reverse the order of the generated array and concatenate it again? Creates a mirrored output. Defaults to `false`.
    
    Example 1: Basic usage
    
    ```
    var a = [1, 2];
    var b = ["A", "B"];
    var options = { qty: 1, repeat: 0 };
    
    var result = Phaser.Utils.Array.Range(a, b, options);
    console.log(result); // Output: [1A, 1B, 2A, 2B]
    /* 
    Output: [
      { a: 1, b: 'A' },
      { a: 1, b: 'B' },
      { a: 2, b: 'A' },
      { a: 2, b: 'B' }
    ]
    */
    ```
    
    Example 2: Repeating and `yoyo` effect
    
    ```
    var a = [1, 2];
    var b = ["A", "B"];
    var options = { qty: 1, repeat: 1, yoyo: true };
    
    var result = Phaser.Utils.Array.Range(a, b, options);
    console.log(result); // Output: [1A, 1B, 2A, 2B, 2B, 2A, 1B, 1A, 1A, 1B, 2A, 2B, 2B, 2A, 1B, 1A]
    /* 
    Output: [
      { a: 1, b: 'A' }, { a: 1, b: 'B' },
      { a: 2, b: 'A' }, { a: 2, b: 'B' },
      { a: 2, b: 'B' }, { a: 2, b: 'A' },
      { a: 1, b: 'B' }, { a: 1, b: 'A' },
      { a: 1, b: 'A' }, { a: 1, b: 'B' },
      { a: 2, b: 'A' }, { a: 2, b: 'B' },
      { a: 2, b: 'B' }, { a: 2, b: 'A' },
      { a: 1, b: 'B' }, { a: 1, b: 'A' }
    ]
    */
    ```
    
    Example 3: Limit the number of generated elements with `max`
    
    ```
    var a = [1, 2];
    var b = ["A", "B"];
    var options = { qty: 1, repeat: -1, max: 5 };
    
    var result = Phaser.Utils.Array.Range(a, b, options);
    console.log(result); // Output: [1A, 1B, 2A, 2B, 1A]
    
    /* 
    Output: [
      { a: 1, b: 'A' },
      { a: 1, b: 'B' },
      { a: 2, b: 'A' },
      { a: 2, b: 'B' },
      { a: 1, b: 'A' }
    ]
    */
    ```
    
    Example 4: Randomizing the Output
    
    ```
    var a = [1, 2];
    var b = ["A", "B"];
    var options = { qty: 1, random: true };
    
    var result = Phaser.Utils.Array.Range(a, b, options);
    console.log(result); // Output: [2B, 1A, 1B, 2A] (randomized order)
    /* 
    Output: [
      { a: 2, b: 'B' },
      { a: 1, b: 'A' },
      { a: 1, b: 'B' },
      { a: 2, b: 'A' },
    ]
    */
    ```
    

### Array Manipulation[​](#array-manipulation "Direct link to Array Manipulation")

*   Moves the specified item to the top of the array.
    
    ```
    BringToTop(array, item);
    ```
    
    *   `item` : The element to move.
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.BringToTop(array, 1);
    console.log(array); // [2, 3, 1]
    ```
    
*   Moves the specified item to the back of the array.
    
    ```
    SendToBack(array, item);
    ```
    
    *   `item` : The element to move.
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.SendToBack(array, 3);
    console.log(array); // [3, 1, 2]
    ```
    
*   Swaps the elements at the given indices.
    
    ```
    Swap(array, item1, item2);
    ```
    
    *   `item1` : The first element to swap.
    *   `item2` : The second element to swap.
    
    Example
    
    ```
    let array = [1, 2, 3, 4, 5];
    Phaser.Utils.Array.Swap(array, 2, 5);
    console.log(array); // [1, 5, 3, 4, 2]
    ```
    

### Bulk Operations[​](#bulk-operations "Direct link to Bulk Operations")

These methods apply to all or most elements of an array.

*   Counts how many elements in the array have a property matching the given value.
    
    ```
    CountAllMatching(array, property, value, [startIndex], [endIndex]);
    ```
    
    *   `property` : The property to test on each array element.
    *   `value` : The value to test the property against. Must pass a strict (===) comparison check.
    *   `startIndex` : Includes the optional start index to search from. Defaults to 0.
    *   `endIndex` : Excludes the optional end index. Defaults to `array` length.
    
    Example 1: Basic usage
    
    ```
    let array = [{ score: 10 }, { score: 20 }, { score: 10 }];
    let count = Phaser.Utils.Array.CountAllMatching(array, "score", 10);
    console.log(count); // 2
    ```
    
    Example 2: Limiting search range
    
    ```
    var array = [
      { name: "apple", color: "red" },
      { name: "banana", color: "yellow" },
      { name: "cherry", color: "red" },
      { name: "grape", color: "purple" },
    ];
    
    var result = Phaser.Utils.Array.CountAllMatching(array, "color", "red", 1, 3);
    console.log(result); // Output: 1
    ```
    
*   Calls a callback for each element in the array.
    
    ```
    Each(array, callback, context, [args]);
    ```
    
    *   `callback` : A callback to be invoked for each item in the array.
    *   `context` : The context in which the callback is invoked.
    *   `args` : Additional arguments that will be passed to the callback, after the current array item.
    
    Example 1: Basic usage
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.Each(array, (item) => console.log(item));
    // Output: 1, 2, 3
    ```
    

Example 2: Custom Context

```
var array = [1, 2, 3];
var context = { multiplier: 2 };

Phaser.Utils.Array.Each(
  array,
  function (element) {
    console.log(element * this.multiplier);
  },
  context
);
// Output: 2, 4, 6
```

Example 3: Passing arguments

```
var array = [1, 2, 3];

Phaser.Utils.Array.Each(
  array,
  function (element, factor) {
    console.log(element * factor);
  },
  null,
  5
);
// Output: 5, 10, 15
```

Example 4: Multiple arguments

```
var array = ["apple", "banana"];

Phaser.Utils.Array.Each(
  array,
  function (element, prefix, suffix) {
    console.log(prefix + element + suffix);
  },
  null,
  "Fruit: ",
  " is tasty"
);
/* Output:
Fruit: apple is tasty
Fruit: banana is tasty
*/
```

*   Calls a callback for each element within a specified index range.
    
    ```
    EachInRange(array, callback, context, startIndex, endIndex, [args]);
    ```
    
    *   `callback` : A callback to be invoked for each item in the array.
    *   `context` : The context in which the callback is invoked.
    *   `startIndex` : Includes the start index to search from.
    *   `endIndex` : Excludes the end index to search to.
    *   `args` : Optional arguments that will be passed to the callback.
    
    Example 1: Specifying a range
    
    ```
    var array = [1, 2, 3, 4, 5];
    Phaser.Utils.Array.EachInRange(
      array,
      function (element) {
        console.log(element);
      },
      null,
      1,
      4
    );
    // Output: 2, 3, 4
    ```
    
    Example 2: Custom context
    
    ```
    var array = [1, 2, 3, 4, 5];
    var context = { multiplier: 2 };
    
    Phaser.Utils.Array.EachInRange(
      array,
      function (element) {
        console.log(element * this.multiplier);
      },
      context,
      3,
      5
    );
    // Output: 8, 10
    ```
    
    Example 3: Specifying a range and passing arguments
    
    ```
    var array = [1, 2, 3, 4, 5];
    
    Phaser.Utils.Array.EachInRange(
      array,
      function (element, prefix, suffix) {
        console.log(prefix + element + suffix);
      },
      null,
      1,
      4,
      "Element: ",
      "!"
    );
    /* Output:
    Element: 2!
    Element: 3!
    Element: 4!
    */
    ```
    
*   Sets the same property value for all elements in the array.
    
    ```
    SetAll(array, property, value, [startIndex], [endIndex]);
    ```
    
    *   `property` : The property to test for on each array element.
    *   `value` : The value to set the property to.
    *   `startIndex` : Includes the optional start index to search from.
    *   `endIndex` : Excludes the optional end index to search to.
    
    Example 1: Basic usage
    
    ```
    let array = [{ score: 10 }, { score: 20 }];
    Phaser.Utils.Array.SetAll(array, "score", 5);
    console.log(array);
    /* Output:
    [
      { score: 5 }, 
      { score: 5 }
    ]
    */
    ```
    
    Example 2: Specifying a range
    
    ```
    let array = [{ score: 10 }, { score: 20 }, { score: 30 }, { score: 40 }];
    Phaser.Utils.Array.SetAll(array, "score", 5, 1, 3);
    console.log(array);
    /* Output:
    [
      { score: 10 }, 
      { score: 5 }, 
      { score: 5 }, 
      { score: 40 }
    ]
    */
    ```
    
*   Replaces the first occurrence of `oldItem` with `newItem`.
    
    ```
    Replace(array, oldItem, newItem);
    ```
    
    *   `oldItem` : The element in the array that will be replaced.
    *   `newItem` : The element to be inserted into the array at the position of oldChild.
    
    Example
    
    ```
    let array = [1, 2, 3];
    Phaser.Utils.Array.Replace(array, 2, 4);
    console.log(array); // [1, 4, 3]
    ```
    

### Rotation[​](#rotation "Direct link to Rotation")

Methods for rotating elements within an array.

*   Rotates the elements of the array to the left by the specified count.
    
    ```
    RotateLeft(array, [total]);
    ```
    
    *   `total` : The number of times to shift the array.
    
    Example
    
    ```
    let array = [1, 2, 3, 4];
    Phaser.Utils.Array.RotateLeft(array, 2);
    console.log(array); // [3, 4, 1, 2]
    ```
    
*   Rotates the elements of the array to the right by the specified count.
    
    ```
    RotateRight(array, [total]);
    ```
    
    *   `total` : The number of times to shift the array.
    
    Example
    
    ```
    let array = [1, 2, 3, 4];
    Phaser.Utils.Array.RotateRight(array, 1);
    console.log(array); // [4, 1, 2, 3]
    ```
    

### Safe Range[​](#safe-range "Direct link to Safe Range")

*   Ensures that the index is within the bounds of the array.
    
    ```
    SafeRange(array, startIndex, endIndex, [throwError]);
    ```
    
    *   `startIndex` : The start index.
    *   `endIndex` : The end index.
    *   `throwError` : Throws an error if set to `true` and the range is out of bounds.
    
    Example
    
    ```
    let array = [1, 2, 3];
    let isValid = Phaser.Utils.Array.SafeRange(array, 2);
    console.log(isValid); // true
    ```
    

## Phaser.Utils.Base64[​](#phaserutilsbase64 "Direct link to Phaser.Utils.Base64")

Provides utility methods for encoding and decoding Base64, specifically converting between ArrayBuffer and Base64 encoded strings. It is used to work with binary data such as images, audio files, or other media types, enabling the transformation of binary data into Base64 strings for transmission or storage.

### ArrayBufferToBase64[​](#arraybuffertobase64 "Direct link to ArrayBufferToBase64")

Converts an `arrayBuffer` into a base64 string. The resulting string can optionally be a data uri if the `mediaType` argument is provided.

```
ArrayBufferToBase64(arrayBuffer, [mediaType]);
```

*   `mediaType` : An optional media type, i.e. `audio/ogg` or `image/jpeg`

Example

```
var buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;  // "Hello" in binary

// Convert the ArrayBuffer to Base64
var base64String = Phaser.Utils.Base64.ArrayBufferToBase64(buffer);

console.log(base64String);  // Output: "SGVsbG8="
```

### Base64ToArrayBuffer[​](#base64toarraybuffer "Direct link to Base64ToArrayBuffer")

Converts a `base64` string, either with or without a data uri, into an Array Buffer.

```
Base64ToArrayBuffer(base64);
```

Example

```
// Assume you have a Base64 string (e.g., retrieved from a database or an API)
var base64String = "SGVsbG8=";  // Base64 for "Hello"

// Convert the Base64 string back to an ArrayBuffer
var arrayBuffer = Phaser.Utils.Base64.Base64ToArrayBuffer(base64String);

// Convert the ArrayBuffer to a string for verification
var uint8Array = new Uint8Array(arrayBuffer);
var decodedString = String.fromCharCode.apply(null, uint8Array);

console.log(decodedString);  // Output: "Hello"
```

## Phaser.Utils.Objects[​](#phaserutilsobjects "Direct link to Phaser.Utils.Objects")

Provides a collection of utility methods to work with objects in Phaser. These methods help manage, manipulate, and extract data from objects, offering functionalities such as cloning, merging, value retrieval, and more.

### Clone[​](#clone "Direct link to Clone")

Creates a shallow copy of an object. Does not clone nested objects.

```
Clone(object)
```

*   `object` : The object to be cloned.

Example

```
var original = { a: 1, b: [2, 3], c: { d: 4 } };
var copy = Phaser.Utils.Objects.Clone(original);
console.log(copy);
/*
{ 
  a: 1,
  b: [2, 3],
  c: {
       d: 4
     } 
}

copy.b is a new array, changing values in original.b or copy.b does not affect either array.
copy.c is a reference to the same object as original.c, changes in original.c is automatically reflected in copy.c
*/
```

### DeepCopy[​](#deepcopy "Direct link to DeepCopy")

Creates a deep copy of an object. This method recursively copies all properties, including nested objects, ensuring that the new object is entirely independent of the original.

```
DeepCopy(source)
```

*   `object` : The object to deep copy.

Example

```
var original = {
    a: 1,
    b: [2, 3, { d: 4 }],
    c: { e: 5, f: [6, 7] }
};
var copy = Phaser.Utils.Objects.DeepCopy(original);
console.log(copy);
/*
{
  a: 1, 
  b: [2, 3, { d: 4 }], 
  c: {
       e: 5,
       f: [6, 7] 
     } 
}
*/
```

### Extend[​](#extend "Direct link to Extend")

This is a slightly modified version of [http://api.jquery.com/jQuery.extend/](http://api.jquery.com/jQuery.extend/). Used to merge properties from one or more objects into a target object. It can perform both shallow and deep copies, depending on the deep flag.

```
Extend(object, source1, source2, ...)
```

*   `object` : The object to extend.
*   `source1`, `source2`, ... : One or more source objects whose properties will be copied to the target.

Example 1: Shallow copy, the `b` property from `obj1` is completely overwritten by the `b` property from `obj2`.

```
var obj1 = { a: 1, b: { c: 2 } };
var obj2 = { b: { d: 3 }, e: 4 };

var result = Phaser.Utils.Objects.Extend({}, obj1, obj2);
console.log(result);
/*
{
  a: 1,
  b: {
       d: 3
     },
  e: 4 
}
*/
```

Example 2: Deep copy, the `b` properties from both `obj1` and `obj2` are merged, preserving the nested structure.

```
var obj1 = { a: 1, b: { c: 2 } };
var obj2 = { b: { d: 3 }, e: 4 };

var result = Phaser.Utils.Objects.Extend({}, obj1, obj2);
console.log(result);
/*
{
  a: 1,
  b: {
       d: 3
     },
  e: 4 
}
*/
```

### GetAdvancedValue[​](#getadvancedvalue "Direct link to GetAdvancedValue")

Retrieves a value from an object with advanced selection options.

```
GetAdvancedValue(source, key, defaultValue)
```

*   `source` : The object from which to get the value.
*   `key` : The key of the value to retrieve.
*   `defaultValue` : The default value to return if the key does not exist.

Example

```
var source = {
    a: [1, 2, 3],
    b: { randInt: [5, 10] },
    c: { randFloat: [0.1, 0.9] },
    d: function (key) { return key + " processed"; },
    e: 42,
    f: null
};

console.log(Phaser.Utils.Objects.GetAdvancedValue(source, 'a', 0));  // Random element from [1, 2, 3]
console.log(Phaser.Utils.Objects.GetAdvancedValue(source, 'b', 0));  // Random integer between 5 and 10
console.log(Phaser.Utils.Objects.GetAdvancedValue(source, 'c', 0));  // Random float between 0.1 and 0.9
console.log(Phaser.Utils.Objects.GetAdvancedValue(source, 'd', 0));  // "d processed"
console.log(Phaser.Utils.Objects.GetAdvancedValue(source, 'e', 0));  // 42
console.log(Phaser.Utils.Objects.GetAdvancedValue(source, 'f', 100));  // 100 (default value as 'f' is null)
```

### GetFastValue[​](#getfastvalue "Direct link to GetFastValue")

Finds the key within the top level of the source object, or returns `defaultValue`.

```
GetFastValue(source, key, defaultValue)
```

*   `source` : The object from which to get the value.
*   `key` : The key of the value to retrieve.
*   `defaultValue` : The default value to return if the key does not exist.

Example

```
var obj = { a: 10, b: 20, c: undefined };

console.log(Phaser.Utils.Objects.GetFastValue(obj, 'a', 0));  // Output: 10
console.log(Phaser.Utils.Objects.GetFastValue(obj, 'b', 0));  // Output: 20
console.log(Phaser.Utils.Objects.GetFastValue(obj, 'c', 0));  // Output: 0 (defaultValue because 'c' is undefined)
console.log(Phaser.Utils.Objects.GetFastValue(obj, 'd', 0));  // Output: 0 (defaultValue because 'd' doesn't exist)
console.log(Phaser.Utils.Objects.GetFastValue(null, 'a', 0)); // Output: 0 (defaultValue because source is null)
console.log(Phaser.Utils.Objects.GetFastValue(42, 'a', 0));   // Output: 0 (defaultValue because source is a number)
```

### GetMinMaxValue[​](#getminmaxvalue "Direct link to GetMinMaxValue")

Retrieves a value from an object, constrained by minimum and maximum values.

```
GetMinMaxValue(source, key, min, max, defaultValue)
```

*   `source` : The object from which to get the value.
*   `key` : The key of the value to retrieve.
*   `min` : The minimum allowed value.
*   `max` : The maximum allowed value.
*   `defaultValue` : The default value to return if the key does not exist.

Example

```
var source = { speed: 120 };

console.log(Phaser.Utils.Objects.GetMinMaxValue(source, 'speed', 50, 100, 75));  // Output: 100 (clamped to max)
console.log(Phaser.Utils.Objects.GetMinMaxValue(source, 'speed', 50, 150, 75));  // Output: 120 (within range)
console.log(Phaser.Utils.Objects.GetMinMaxValue(source, 'acceleration', 50, 100, 75)); // Output: 75 (uses default value)
console.log(Phaser.Utils.Objects.GetMinMaxValue(source, 'acceleration', 50, 100));  // Output: 50 (default is set to min)
```

### GetValue[​](#getvalue "Direct link to GetValue")

Retrieves a value from an object, falling back to a default value if the `key` is not found. The `key` is a string, which can be split based on the use of the period character.

```
GetValue(source, key, defaultValue)
```

*   `source` : The object from which to get the value.
*   `key` : The key of the value to retrieve.
*   `defaultValue` : The default value to return if the key does not exist.

Example

```
var source = { a: { b: { c: 10 } }, x: 5 };
var altSource = { a: { b: { c: 20 } }, y: 15 };

console.log(Phaser.Utils.Objects.GetValue(source, 'a.b.c', 0));  // Output: 10 (found in source)
console.log(Phaser.Utils.Objects.GetValue(source, 'y', 0, altSource));  // Output: 15 (found in altSource)
console.log(Phaser.Utils.Objects.GetValue(source, 'x', 0));  // Output: 5 (found in source)
console.log(Phaser.Utils.Objects.GetValue(source, 'a.b.z', 0));  // Output: 0 (default value, not found)
```

### HasAll[​](#hasall "Direct link to HasAll")

Checks if an object has all specified keys.

```
HasAll(source, keys)
```

*   `source` : The object to check.
*   `keys`: An array of keys to check for.

Example

```
var obj = { a: 1, b: 2, c: 3 };

console.log(Phaser.Utils.Objects.HasAll(obj, ['a', 'b']));  // Output: true (both 'a' and 'b' are present)
console.log(Phaser.Utils.Objects.HasAll(obj, ['a', 'd']));  // Output: false ('d' is missing)
console.log(Phaser.Utils.Objects.HasAll(obj, ['a', 'b', 'c']));  // Output: true (all keys are present)
```

### HasAny[​](#hasany "Direct link to HasAny")

Checks if an object has any of the specified keys.

```
HasAny(source, keys)
```

*   `source` : The object to check.
*   `keys` : An array of keys to check for.

Example

```
var obj = { a: 1, b: 2, c: 3 };

console.log(Phaser.Utils.Objects.HasAny(obj, ['a', 'd']));  // Output: true ('a' is found)
console.log(Phaser.Utils.Objects.HasAny(obj, ['x', 'y']));  // Output: false (none of the keys are found)
console.log(Phaser.Utils.Objects.HasAny(obj, ['b', 'c']));  // Output: true ('b' is found)
```

### HasValue[​](#hasvalue "Direct link to HasValue")

Checks if an object has a key with a specific value.

```
HasValue(source, key)
```

*   `source` : The object to check.
*   `key` : The key to check for.

Example

```
var obj = { name: 'Alice', age: 25 };

console.log(Phaser.Utils.Objects.HasValue(obj, 'name'));  // Output: true (because 'name' is a property of obj)
console.log(Phaser.Utils.Objects.HasValue(obj, 'gender'));  // Output: false (because 'gender' is not a property of obj)
```

### IsPlainObject[​](#isplainobject "Direct link to IsPlainObject")

Checks if a given value is a plain object (i.e., created using `{}` or `new Object()`).

```
console.log(Phaser.Utils.Objects.IsPlainObject({}));                 // true (plain object)
console.log(Phaser.Utils.Objects.IsPlainObject(new Object()));       // true (plain object)
console.log(Phaser.Utils.Objects.IsPlainObject([]));                 // false (array, not a plain object)
console.log(Phaser.Utils.Objects.IsPlainObject(document.body));      // false (DOM node, not a plain object)
console.log(Phaser.Utils.Objects.IsPlainObject(window));             // false (window object, not a plain object)
console.log(Phaser.Utils.Objects.IsPlainObject(null));               // false (null, not an object)
```

*   `object` : The value to check.

Example

```

var isPlainObject = Phaser.Utils.Objects.IsPlainObject(obj);
```

### Merge[​](#merge "Direct link to Merge")

Creates a new Object using all values from `obj1` and `obj2`. If a value exists in both obj1 and obj2, the value in obj1 is used. This is only a shallow copy. Deeply nested objects are not cloned, so be sure to only use this function on shallow objects.

```
Merge(obj1, obj2)
```

*   `obj1` : The first object.
*   `obj2` : The second object.

Example

```
var obj1 = { a: 1, b: 2 };
var obj2 = { b: 3, c: 4 };

var result = Phaser.Utils.Objects.Merge(obj1, obj2);

console.log(result);  // Output: { a: 1, b: 2, c: 4 }
console.log(obj1);    // Output: { a: 1, b: 2 } (unchanged)
console.log(obj2);    // Output: { b: 3, c: 4 } (unchanged)
```

### MergeRight[​](#mergeright "Direct link to MergeRight")

Creates a new Object using all values from `obj1`. Then scans `obj2`. If a property is found in `obj2` that also exists in `obj1`, the value from `obj2` is used, otherwise the property is skipped.

```
MergeRight(obj1, obj2)
```

*   `obj1` : The first object to merge.
*   `obj2` : The second object to merge. Keys from this object which also exist in `obj1` will be copied to `obj1`.

Example

```
var obj1 = { a: 1, b: 2, c: 3 };
var obj2 = { b: 20, c: 30, d: 40 };

var result = Phaser.Utils.Objects.MergeRight(obj1, obj2);

console.log(result);  // Output: { a: 1, b: 20, c: 30 }
console.log(obj1);    // Output: { a: 1, b: 2, c: 3 } (unchanged)
console.log(obj2);    // Output: { b: 20, c: 30, d: 40 } (unchanged)
```

### Pick[​](#pick "Direct link to Pick")

Returns a new object that only contains the `keys` that were found on the object provided. If no keys are found, an empty object is returned.

```
Pick(source, keys)
```

*   `source` : The object to pick properties from.
*   `keys` : An array of properties to retrieve from the provided object.

Example

```
var person = { name: 'Alice', age: 30, city: 'New York', occupation: 'Engineer' };
var selectedKeys = ['name', 'city'];

var result = Phaser.Utils.Objects.Pick(person, selectedKeys);

console.log(result);  // Output: { name: 'Alice', city: 'New York' }
```

### SetValue[​](#setvalue "Direct link to SetValue")

Sets a value in an object, creating the property path if necessary.

```
SetValue(source, key, value)
```

*   `source` : The object to set the value in.
*   `key` : The property path (e.g., `'a.b.c'`).
*   `value` : The value to set.

Example

```
var obj = {
    a: {
        b: {
            c: 10
        }
    }
};

// Set a simple property
var results = Phaser.Utils.Objects.SetValue(obj, 'a', 100);  // Returns true
console.log(obj);  // { a: 100 }

// Set a nested property
var results = Phaser.Utils.Objects.SetValue(obj, 'a.b.c', 20);  // Returns true
console.log(obj);  // { a: { b: { c: 20 } } }

// Try to set a non-existent nested property
var results = Phaser.Utils.Objects.SetValue(obj, 'a.x.y', 50);  // Returns false
console.log(obj); // no change to obj
```

## Phaser.Utils.String[​](#phaserutilsstring "Direct link to Phaser.Utils.String")

Contains utility functions for manipulating and formatting strings. It simplifies common string operations such as formatting, padding, and reversing strings.

### Format[​](#format "Direct link to Format")

Takes a string and replaces instances of markers with values in the given array. The markers take the form of `%1`, `%2`, etc. I.e.: `Format("The %1 is worth %2 gold", [ 'Sword', 500 ])`

```
Format(string, values);
```

*   `string` (string): The string containing the replacement markers.
*   `values` (object): An array containing values that will replace the markers. If no value exists an empty string is inserted instead.

Example:

```
var string = "Player %1 scored %2 points";
var values = ["Alice", 100];
var result = Phaser.Utils.String.Format(string, values);
console.log(result); // result: "Player Alice scored 100 points"
```

### Pad[​](#pad "Direct link to Pad")

Takes the given string and pads it out, to the length required, using the character specified.

```
Pad(str, [len], [pad], [dir])
```

Parameters:

*   `str` : The original string to pad.
*   `len` : The target length of the resulting string.
*   `pad` : The character(s) to pad the string with.
*   `dir` : The direction of padding. Use:
    *   `1` for right padding,
    *   `2` for left padding,
    *   `3` for both sides padding.

Example

```
var padLeft = Phaser.Utils.String.Pad("7", 3, "0", 1); // Left Padding (dir = 1): "007"
var padRight = Phaser.Utils.String.Pad("7", 3, "0", 2); // Right Padding (dir = 2 or any other value): "700"
var padBoth = Phaser.Utils.String.Pad("7", 3, "0", 3); // Both Sides Padding (dir = 3): "070"
```

### RemoveAt[​](#removeat "Direct link to RemoveAt")

Takes a string and removes the character at the given index.

```
RemoveAt(string, index)
```

Parameters:

*   `string` : The original string.
*   `index` : The zero-based index of the character to remove.

Example:

```
const result = Phaser.Utils.String.RemoveAt("Phaser", 2); // result: "Phser"
```

### Reverse[​](#reverse "Direct link to Reverse")

Takes the given string and reverses it, returning the reversed string.

```
Reverse(string)
```

*   `string` : The string to reverse.

Example:

```
const result = Phaser.Utils.String.Reverse("Phaser"); // result: "resahP"
```

### UppercaseFirst[​](#uppercasefirst "Direct link to UppercaseFirst")

Capitalizes the first letter of a string if there is one.

```
UppercaseFirst(string)
```

*   `string` (string): The string to modify.

Example:

```
const result = Phaser.Utils.String.UppercaseFirst("phaser"); // result: "Phaser"
```

### UUID[​](#uuid "Direct link to UUID")

Creates and returns a random RFC4122 version 4 compliant universally unique identifier (UUID).

The string is in the form: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` where each `x` is replaced with a random hexadecimal digit from 0 to f, and `y` is replaced with a random hexadecimal digit from 8 to b.

```
UUID()
```

Example:

```
const uuid = Phaser.Utils.String.UUID();
// result: "3b42e58f-0d1c-4b2a-b8f7-e123456789ab"
```
