// Function to optimize data size for large datasets
function optimizeDataSize(data) {
    // If data is not too large, return it as is
    if (!data || data.length < 50000) {
        return data;
    }
    
    console.log('Optimizing large dataset with ' + data.length + ' records');
    
    // Calculate how many points to sample (max 20000 points for performance)
    const maxPoints = 20000;
    const skipFactor = Math.ceil(data.length / maxPoints);
    
    // Sample data evenly
    const optimized = [];
    for (let i = 0; i < data.length; i += skipFactor) {
        optimized.push(data[i]);
    }
    
    console.log('Optimized dataset size: ' + optimized.length + ' records');
    return optimized;
}
