# Physics

Phaser has two physics systems built in. The first is called Arcade Physics and the second is Matter JS.

[Arcade Physics](/phaser/concepts/physics/arcade) is, as its name implies, meant for more 'arcade' or 'retro' style games, although is not limited just to those. It's a lightweight physics system that can only handle two different types of physics shapes: rectangles and circles. It's not meant for complex physics simulations, but rather for simple things like platformers, top-down games, or puzzle games. It's very fast and easy to use, with lots of helper functions, but due to its nature it does have its limitations.

[Matter JS](/phaser/concepts/physics/matter) is an open-source third party physics library and Phaser has its own custom version of it bundled. The reason for including Matter is that it provides a more advanced 'full body' physics system. If you need to move beyond rectangles and circles, with more complex physics shapes, and features such as constraints, joints and behaviours, then Matter is the system to use.

Both physics systems need to be enabled before they can be used. This can be done via the Game Configuration or on a per-Scene basis. Once enabled, you can then add physics-enabled Game Objects to your game. For example, if you enable Arcade Physics, you can then add a Sprite and enable physics on it. This will allow you to control the Sprite using the built-in physics functions, such as velocity, acceleration, gravity, etc.

By default a Game Object is not enabled for physics. This is because not all Game Objects need to be. For example, a background image or game logo likely doesn't need to be affected by physics, but a player character does. Therefore, you must enable physics on the Game Objects that you specifically want to be affected by it. We will cover this in detail in later chapters.

The two systems are entirely separate. An Arcade Physics sprite, for example, cannot collide with a Matter Physics sprite. You cannot add the same Sprite to both systems, you need to pick one or the other. However, although it's unusual to do so, both systems can actually run in parallel in the same Scene. This means that you can have a Sprite that uses Arcade Physics and another that uses Matter Physics, and they will both work at the same time, although they will not interact together.
