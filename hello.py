import random

secret = random.randint(1, 10)
guesses = 3
print("Number Goblin: guess my number from 1 to 10!")
while guesses:
    guess = int(input(f"{guesses} guesses left: "))
    if guess == secret:
        print("You defeated the goblin!")
        break
    print("Too low!" if guess < secret else "Too high!")
    guesses -= 1
print(f"Game over. The secret number was {secret}.")
