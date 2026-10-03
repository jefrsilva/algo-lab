# Classes que a DSL oferece prontas (Node(v), TreeNode(v), GraphNode(v)) —
# python.test.js põe isto antes de cada programa de casos.js pra rodar o
# mesmo código no Python real.


class Node:
    def __init__(self, data):
        self.data = data
        self.next = None
        self.prev = None


class TreeNode:
    def __init__(self, data):
        self.data = data
        self.left = None
        self.right = None


class GraphNode:
    def __init__(self, data):
        self.data = data
        self.neighbors = []
